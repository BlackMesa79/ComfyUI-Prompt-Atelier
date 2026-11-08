import importlib.util
import logging
from pathlib import Path

# 使用唯一模块名加载，避免污染全局搜索路径和其他扩展的模块名。
try:
    spec = importlib.util.spec_from_file_location(
        "prompt_atelier_tag_server", Path(__file__).parent / "py" / "tag_server.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.register_routes()
except Exception:
    logging.getLogger(__name__).exception("[PromptAtelier] 标签服务加载失败，其他扩展仍可继续加载")

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./web"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
