from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sqlalchemy.orm import Session

from app.models import ModelCatalog


MODEL_CATALOG_SEED: Sequence[dict[str, Any]] = (
    {
        "id": "00000000-0000-0000-0000-000000000001",
        "model_id": "qwen3.5-flash",
        "display_name": "Qwen3.5-Flash",
        "provider": "qwen",
        "category": "llm",
        "description": "高性价比通用模型，支持视觉输入与函数调用，适合日常对话和轻量多模态任务。",
        "capabilities": ["text", "vision", "function_calling"],
        "context_window": 1000000,
        "max_output": 8192,
        "input_price": 0.0003,
        "output_price": 0.0018,
        "is_active": True,
        "sort_order": 10,
    },
    {
        "id": "00000000-0000-0000-0000-000000000002",
        "model_id": "qwen3.5-plus",
        "display_name": "Qwen3.5-Plus",
        "provider": "qwen",
        "category": "llm",
        "description": "均衡的旗舰级通用模型，支持视觉、函数调用和联网搜索。",
        "capabilities": ["text", "vision", "function_calling", "web_search"],
        "context_window": 1000000,
        "max_output": 8192,
        "input_price": 0.0008,
        "output_price": 0.0048,
        "is_active": True,
        "sort_order": 20,
    },
    {
        "id": "00000000-0000-0000-0000-000000000003",
        "model_id": "qwen3-max",
        "display_name": "Qwen3-Max",
        "provider": "qwen",
        "category": "llm",
        "description": "旗舰多模态模型，适合复杂分析、创作和联网搜索场景。",
        "capabilities": ["text", "vision", "function_calling", "web_search"],
        "context_window": 252000,
        "max_output": 8192,
        "input_price": 0.0025,
        "output_price": 0.01,
        "is_active": True,
        "sort_order": 30,
    },
    {
        "id": "00000000-0000-0000-0000-000000000004",
        "model_id": "deepseek-v3.2",
        "display_name": "DeepSeek V3.2",
        "provider": "deepseek",
        "category": "llm",
        "description": "高性价比通用模型，支持函数调用和联网搜索。",
        "capabilities": ["text", "function_calling", "web_search"],
        "context_window": 131072,
        "max_output": 8192,
        "input_price": 0.001,
        "output_price": 0.005,
        "is_active": True,
        "sort_order": 40,
    },
    {
        "id": "00000000-0000-0000-0000-000000000005",
        "model_id": "deepseek-r1",
        "display_name": "DeepSeek R1",
        "provider": "deepseek",
        "category": "llm",
        "description": "偏重深度推理与思维链场景，适合复杂分析与求解。",
        "capabilities": ["text", "reasoning_chain"],
        "context_window": 131072,
        "max_output": 8192,
        "input_price": 0.002,
        "output_price": 0.01,
        "is_active": True,
        "sort_order": 50,
    },
    {
        "id": "00000000-0000-0000-0000-000000000006",
        "model_id": "paraformer-v2",
        "display_name": "Paraformer-v2",
        "provider": "qwen",
        "category": "asr",
        "description": "实时语音识别模型，支持中英文混合输入。",
        "capabilities": ["chinese", "english", "realtime"],
        "context_window": 0,
        "max_output": 0,
        "input_price": 0.0,
        "output_price": 0.0,
        "is_active": True,
        "sort_order": 10,
    },
    {
        "id": "00000000-0000-0000-0000-000000000007",
        "model_id": "sensevoice-v1",
        "display_name": "SenseVoice",
        "provider": "qwen",
        "category": "asr",
        "description": "支持情绪理解的语音识别模型，覆盖中英文场景。",
        "capabilities": ["chinese", "english", "emotion"],
        "context_window": 0,
        "max_output": 0,
        "input_price": 0.0,
        "output_price": 0.0,
        "is_active": True,
        "sort_order": 20,
    },
    {
        "id": "00000000-0000-0000-0000-000000000008",
        "model_id": "cosyvoice-v1",
        "display_name": "CosyVoice",
        "provider": "qwen",
        "category": "tts",
        "description": "自然风格语音合成模型，支持多音色和情绪表达。",
        "capabilities": ["multi_voice", "emotion", "natural"],
        "context_window": 0,
        "max_output": 0,
        "input_price": 0.0,
        "output_price": 0.0,
        "is_active": True,
        "sort_order": 10,
    },
    {
        "id": "00000000-0000-0000-0000-000000000009",
        "model_id": "sambert-v1",
        "display_name": "Sambert",
        "provider": "qwen",
        "category": "tts",
        "description": "标准型语音合成模型，强调速度和稳定性。",
        "capabilities": ["standard", "fast"],
        "context_window": 0,
        "max_output": 0,
        "input_price": 0.0,
        "output_price": 0.0,
        "is_active": True,
        "sort_order": 20,
    },
    {
        "id": "00000000-0000-0000-0000-000000000010",
        "model_id": "qwen-vl-plus",
        "display_name": "Qwen-VL-Plus",
        "provider": "qwen",
        "category": "vision",
        "description": "视觉理解模型，支持图像、OCR 与视频分析。",
        "capabilities": ["image", "ocr", "video"],
        "context_window": 8192,
        "max_output": 2048,
        "input_price": 0.001,
        "output_price": 0.0,
        "is_active": True,
        "sort_order": 10,
    },
    {
        "id": "00000000-0000-0000-0000-000000000011",
        "model_id": "qwen-vl-max",
        "display_name": "Qwen-VL-Max",
        "provider": "qwen",
        "category": "vision",
        "description": "旗舰视觉模型，支持图像、OCR、视频与复杂推理。",
        "capabilities": ["image", "ocr", "video", "reasoning"],
        "context_window": 8192,
        "max_output": 2048,
        "input_price": 0.003,
        "output_price": 0.0,
        "is_active": True,
        "sort_order": 20,
    },
    {
        "id": "00000000-0000-0000-0000-000000000012",
        "model_id": "qwen3-omni-flash-realtime",
        "display_name": "Qwen3 Omni Flash Realtime",
        "provider": "qwen",
        "category": "llm",
        "description": "端到端全模态实时模型，直接接收音频、图片与文本并输出语音和文字。",
        "capabilities": ["text", "vision", "audio_input", "audio_output", "realtime", "multilingual"],
        "context_window": 131072,
        "max_output": 8192,
        "input_price": 0.0022,
        "output_price": 0.0083,
        "is_active": True,
        "sort_order": 5,
    },
)


def seed_model_catalog(db: Session) -> None:
    existing = {
        item.model_id: item
        for item in db.query(ModelCatalog).all()
    }
    changed = False

    for seed in MODEL_CATALOG_SEED:
        row = existing.get(seed["model_id"])
        if row is None:
            db.add(ModelCatalog(**seed))
            changed = True
            continue

        for key, value in seed.items():
            if getattr(row, key) != value:
                setattr(row, key, value)
                changed = True

    if changed:
        db.commit()
