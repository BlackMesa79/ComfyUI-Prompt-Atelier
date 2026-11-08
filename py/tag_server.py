import asyncio
import csv
import io
import json
import logging
import os
import shutil
import tempfile
import time
from datetime import datetime, timezone

import aiohttp
from aiohttp import web

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_TAGS_FILE = os.path.join(_BASE, "web", "tags", "danbooru.csv")
_TAGS_URL = "https://raw.githubusercontent.com/PYU224/tagdb-updater/main/dist/danbooru.csv"
_LOG = logging.getLogger(__name__)
_INTERVALS = {"daily": 86400, "weekly": 7 * 86400, "monthly": 30 * 86400}
_RETRY_SECONDS = 3600


def validate_csv(content):
    """在覆盖旧文件之前校验所有记录，拒绝空内容和截断的 CSV。"""
    if not content.strip():
        raise ValueError("下载内容为空")
    count = 0
    try:
        for row in csv.reader(io.StringIO(content.lstrip("\ufeff")), strict=True):
            if not row:
                continue
            if count == 0 and row[:3] in (["tag", "category", "post_count"], ["tag", "category", "count"]):
                continue
            if len(row) < 3 or not row[0] or not (row[1].isascii() and row[1].isdigit()) or not (row[2].isascii() and row[2].isdigit()):
                raise ValueError("标签记录格式错误：应为 tag,category,count")
            count += 1
    except csv.Error as error:
        raise ValueError("CSV 引号或字段格式错误") from error
    if count <= 10000:
        raise ValueError(f"标签数量不足：{count}，必须大于 10000")
    return count


def atomic_write(content, path=None):
    """同目录临时文件写入完成后原子替换；失败时保留旧文件。"""
    path = path or _TAGS_FILE
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="", dir=directory, prefix=".danbooru-", suffix=".tmp", delete=False) as handle:
            temporary = handle.name
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def error_response(code, message, status):
    return web.json_response({"success": False, "code": code, "error": message}, status=status)


def migrate_config(config_path):
    """仅首次复制旧配置；完整写入临时文件后独占发布，保留旧文件。"""
    legacy_path = os.path.join(os.path.dirname(config_path), "prompt_autocomplete.json")
    if os.path.exists(config_path) or not os.path.isfile(legacy_path):
        return
    temporary = None
    try:
        with open(legacy_path, "rb") as source:
            with tempfile.NamedTemporaryFile(dir=os.path.dirname(config_path), prefix=".prompt-atelier-", suffix=".tmp", delete=False) as target:
                temporary = target.name
                shutil.copyfileobj(source, target)
                target.flush()
                os.fsync(target.fileno())
        # 硬链接创建具有独占语义，竞争者已创建目标时不会覆盖它。
        try:
            os.link(temporary, config_path)
        except FileExistsError:
            return
        _LOG.info("[PromptAtelier] 旧更新配置已原样迁移，旧文件保留")
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def default_config():
    return {"auto_update": "weekly", "last_success_at": None, "last_check_at": None,
            "last_error": None, "etag": None, "last_modified": None}


def timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.timestamp() if parsed.tzinfo else None
    except (ValueError, OverflowError, OSError):
        return None


def iso_time(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def next_check_time(config, now):
    """返回最早允许尝试的时间；实际检查由每小时的调度执行。"""
    interval = _INTERVALS.get(config.get("auto_update"))
    if interval is None:
        return None
    success = timestamp(config.get("last_success_at"))
    checked = timestamp(config.get("last_check_at"))
    return max(success + interval if success is not None else now,
               checked + _RETRY_SECONDS if checked is not None else now)


def update_due(config, now):
    next_time = next_check_time(config, now)
    return next_time is not None and now >= next_time


class UpdateFailure(Exception):
    def __init__(self, code, message, status=502):
        super().__init__(message)
        self.code, self.status = code, status


class TagUpdateService:
    """由扩展入口显式创建；导入本模块不会注册路由、读写文件或启动任务。"""

    def __init__(self, server, config_path):
        self.server = server
        self.config_path = config_path
        self.config = default_config()
        self.config_loaded = False
        self.config_lock = asyncio.Lock()
        self.update_lock = asyncio.Lock()
        self.task = None
        self.initial_delay = 60
        self.check_interval = 3600
        self.timeout = 120
        self.clock = time.time
        self.status_cache = None

    def read_config(self):
        try:
            migrate_config(self.config_path)
            with open(self.config_path, encoding="utf-8-sig") as handle:
                data = json.load(handle)
            if not isinstance(data, dict) or data.get("auto_update", "weekly") not in {"off", *_INTERVALS}:
                raise ValueError("auto_update 无效")
            result = default_config()
            for key in result:
                value = data.get(key, result[key])
                if key.endswith("_at") and value is not None and timestamp(value) is None:
                    raise ValueError("更新时间无效")
                if key != "auto_update" and value is not None and not isinstance(value, str):
                    raise ValueError("配置字段类型无效")
                if key in ("etag", "last_modified") and value and ("\r" in value or "\n" in value):
                    raise ValueError("条件请求字段无效")
                result[key] = value
            return result
        except FileNotFoundError:
            return default_config()
        except Exception as error:
            _LOG.warning("[PromptAtelier] 配置读取失败，使用默认值：%s", error)
            result = default_config()
            result["last_error"] = f"配置读取失败，已回退默认值：{error}"
            return result

    async def ensure_config(self):
        async with self.config_lock:
            if not self.config_loaded:
                self.config = await asyncio.to_thread(self.read_config)
                self.config_loaded = True

    async def save_config(self, changes, keep_on_failure=False):
        await self.ensure_config()
        async with self.config_lock:
            result = {**self.config, **changes}
            try:
                await asyncio.to_thread(atomic_write, json.dumps(result, ensure_ascii=False, indent=2), self.config_path)
            except Exception:
                # 更新失败的退避仍需保存在内存，防止磁盘故障造成频繁重试。
                if keep_on_failure:
                    self.config = result
                raise
            self.config = result

    def file_status(self):
        try:
            info = os.stat(_TAGS_FILE)
        except FileNotFoundError:
            self.status_cache = None
            return {"exists": False, "size_bytes": 0, "modified_at": None, "tag_count": 0}
        signature = (info.st_mtime_ns, info.st_size)
        if self.status_cache and self.status_cache[0] == signature:
            return dict(self.status_cache[1])
        with open(_TAGS_FILE, encoding="utf-8-sig", newline="") as handle:
            count = sum(1 for row in csv.reader(handle) if len(row) >= 3 and row[1].isascii()
                        and row[1].isdigit() and row[2].isascii() and row[2].isdigit())
        result = {"exists": True, "size_bytes": info.st_size, "modified_at": iso_time(info.st_mtime), "tag_count": count}
        self.status_cache = (signature, result)
        return dict(result)

    async def get_tags(self, request):
        if os.path.isfile(_TAGS_FILE):
            return web.FileResponse(_TAGS_FILE)
        return error_response("not_found", "标签库不存在，请先下载标签库", 404)

    async def get_status(self, request):
        try:
            return web.json_response(await asyncio.to_thread(self.file_status))
        except OSError as error:
            return error_response("status_failed", f"读取标签库状态失败：{error}", 500)

    async def config_status(self):
        await self.ensure_config()
        status = await asyncio.to_thread(self.file_status)
        due = next_check_time(self.config, self.clock())
        return {**self.config, **status, "next_check_at": iso_time(due) if due is not None else None,
                "updating": self.update_lock.locked()}

    async def get_config(self, request):
        try:
            return web.json_response(await self.config_status())
        except Exception as error:
            return error_response("config_failed", f"读取配置状态失败：{error}", 500)

    async def post_config(self, request):
        try:
            data = await request.json()
            value = data.get("auto_update") if isinstance(data, dict) else None
            if not isinstance(value, str) or value not in {"off", *_INTERVALS}:
                return error_response("invalid_config", "auto_update 必须是 off、daily、weekly 或 monthly", 400)
            await self.save_config({"auto_update": value})
            return web.json_response(await self.config_status())
        except (ValueError, UnicodeError):
            return error_response("invalid_config", "请求必须是有效的 JSON", 400)
        except Exception as error:
            return error_response("config_failed", f"保存配置失败：{error}", 500)

    async def download(self):
        headers = {}
        # 本地文件缺失时不能使用旧校验器，否则 304 无法恢复标签库。
        if os.path.isfile(_TAGS_FILE):
            if self.config["etag"]:
                headers["If-None-Match"] = self.config["etag"]
            if self.config["last_modified"]:
                headers["If-Modified-Since"] = self.config["last_modified"]
        async with aiohttp.ClientSession(trust_env=True, timeout=aiohttp.ClientTimeout(total=self.timeout)) as session:
            async with session.get(_TAGS_URL, headers=headers) as response:
                if response.status == 304:
                    if not os.path.isfile(_TAGS_FILE):
                        raise UpdateFailure("missing_local_file", "上游返回 304，但本地标签库不存在")
                    status = await asyncio.to_thread(self.file_status)
                    return {"changed": False, "not_modified": True, "tag_count": status["tag_count"]}, {}, None
                if response.status != 200:
                    raise UpdateFailure("upstream_http", f"下载失败：HTTP {response.status}")
                content = await response.text(encoding="utf-8")
                validators = {"etag": response.headers.get("ETag"), "last_modified": response.headers.get("Last-Modified")}
        count = await asyncio.to_thread(validate_csv, content)

        def content_changed():
            try:
                with open(_TAGS_FILE, "rb") as handle:
                    return handle.read() != content.encode("utf-8")
            except FileNotFoundError:
                return True

        changed = await asyncio.to_thread(content_changed)
        return {"changed": changed, "not_modified": False, "tag_count": count}, validators, content if changed else None

    def commit_files(self, content, config):
        """两个文件无法跨目录原子替换；配置提交失败时用原文件副本回滚标签。"""
        backup = None
        replaced = False
        try:
            if content is not None:
                directory = os.path.dirname(_TAGS_FILE)
                os.makedirs(directory, exist_ok=True)
                if os.path.isfile(_TAGS_FILE):
                    with tempfile.NamedTemporaryFile(dir=directory, prefix=".danbooru-rollback-", delete=False) as handle:
                        backup = handle.name
                    shutil.copy2(_TAGS_FILE, backup)
                atomic_write(content)
                replaced = True
            atomic_write(json.dumps(config, ensure_ascii=False, indent=2), self.config_path)
        except Exception:
            if replaced:
                if backup:
                    os.replace(backup, _TAGS_FILE)
                    backup = None
                else:
                    os.unlink(_TAGS_FILE)
            raise
        finally:
            if backup and os.path.exists(backup):
                try:
                    os.unlink(backup)
                except OSError:
                    _LOG.warning("[PromptAtelier] 临时备份无法清理：%s", backup)

    async def commit_success(self, content, validators):
        async with self.config_lock:
            success = iso_time(self.clock())
            config = {**self.config, "last_success_at": success, "last_check_at": success,
                      "last_error": None, **validators}
            # 取消等待不会停止工作线程；等提交结束后再释放锁，避免下一次更新交错写入。
            worker = asyncio.create_task(asyncio.to_thread(self.commit_files, content, config))
            try:
                await asyncio.shield(worker)
            except asyncio.CancelledError:
                await worker
                self.config = config
                raise
            self.config = config
            return success

    async def perform_update(self, automatic=False):
        await self.ensure_config()
        if self.update_lock.locked():
            return {"success": False, "code": "update_in_progress", "error": "标签库正在更新，请稍后重试"}, 409
        async with self.update_lock:
            if automatic and not update_due(self.config, self.clock()):
                return {"success": True, "skipped": True}, 200
            attempt = iso_time(self.clock())
            try:
                await self.save_config({"last_check_at": attempt}, keep_on_failure=True)
                result, validators, content = await self.download()
                success = await self.commit_success(content, validators)
                result.update(success=True, downloaded_at=success)
                if result["changed"]:
                    self.notify_changed(result)
                return result, 200
            except asyncio.CancelledError:
                raise
            except Exception as error:
                if isinstance(error, UpdateFailure):
                    code, status, message = error.code, error.status, str(error)
                elif isinstance(error, asyncio.TimeoutError):
                    code, status, message = "timeout", 504, "下载超时，请稍后重试"
                elif isinstance(error, aiohttp.ClientError):
                    code, status, message = "network_error", 502, f"下载网络异常：{error}"
                elif isinstance(error, (ValueError, UnicodeError)):
                    code, status, message = "invalid_csv", 502, f"下载校验失败：{error}"
                else:
                    code, status, message = "update_failed", 500, f"更新失败：{error}"
                try:
                    # 完成失败之后至少再等一小时，长下载不会缩短重试间隔。
                    await self.save_config({"last_check_at": iso_time(self.clock()), "last_error": message}, keep_on_failure=True)
                except Exception:
                    _LOG.exception("[PromptAtelier] 无法持久化更新失败状态")
                _LOG.warning("[PromptAtelier] %s", message)
                return {"success": False, "code": code, "error": message}, status

    def notify_changed(self, result):
        try:
            self.server.send_sync("prompt_atelier.tags_updated", result)
        except Exception:
            _LOG.exception("[PromptAtelier] 标签已更新，但前端通知失败")

    async def update_tags(self, request):
        result, status = await self.perform_update()
        return web.json_response(result, status=status)

    async def scheduler(self):
        await asyncio.sleep(self.initial_delay)
        while True:
            try:
                await self.perform_update(automatic=True)
            except asyncio.CancelledError:
                raise
            except Exception:
                _LOG.exception("[PromptAtelier] 自动更新检查异常，将在一小时后重试")
            await asyncio.sleep(self.check_interval)

    def start_scheduler(self):
        # 所有创建操作排入宿主循环：即使循环尚未运行也安全，多个回调只创建一个任务。
        def start():
            if self.task is None or self.task.done():
                self.task = self.server.loop.create_task(self.scheduler(), name="prompt-atelier-update")
        try:
            self.server.loop.call_soon_threadsafe(start)
        except Exception:
            _LOG.exception("[PromptAtelier] 无法启动自动更新调度器")


def register_routes():
    try:
        from server import PromptServer
        from folder_paths import get_user_directory
        server = PromptServer.instance
        existing = getattr(server, "_prompt_atelier_service", None)
        if existing is not None:
            existing.start_scheduler()
            return existing
        service = TagUpdateService(server, os.path.join(get_user_directory(), "prompt_atelier.json"))
        # 启动即迁移并读取配置，不等首次浏览器请求或调度延迟。
        service.config = service.read_config()
        service.config_loaded = True
        routes = server.routes
        routes.get("/prompt-atelier/tags")(service.get_tags)
        routes.get("/prompt-atelier/status")(service.get_status)
        routes.post("/prompt-atelier/update")(service.update_tags)
        routes.get("/prompt-atelier/config")(service.get_config)
        routes.post("/prompt-atelier/config")(service.post_config)
        server._prompt_atelier_service = service
        service.start_scheduler()
        return service
    except Exception as error:
        _LOG.warning("[PromptAtelier] 路由注册失败，标签服务暂不可用（非 ComfyUI 环境可忽略）：%s", error)
