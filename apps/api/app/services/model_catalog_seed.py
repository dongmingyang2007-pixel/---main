from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sqlalchemy.orm import Session

from app.models import ModelCatalog


MODEL_CATALOG_SEED: Sequence[dict[str, Any]] = (
    {
        "id": "00000000-0000-0000-0000-000000000001",
        "model_id": "qwen3.5-flash",
        "display_name": "Qwen3.5 Flash",
        "provider": "alibaba",
        "category": "llm",
        "description": "通义千问 3.5 Flash，超快速推理，适合日常对话与简单任务。",
        "capabilities": ["text", "chat", "function_calling", "streaming"],
        "context_window": 131072,
        "max_output": 8192,
        "input_price": 0.3,
        "output_price": 0.6,
        "is_active": True,
        "sort_order": 10,
    },
    {
        "id": "00000000-0000-0000-0000-000000000002",
        "model_id": "qwen3.5-plus",
        "display_name": "Qwen3.5 Plus",
        "provider": "alibaba",
        "category": "llm",
        "description": "通义千问 3.5 Plus，均衡的智能与速度，支持视觉输入，适合复杂对话与内容生成。",
        "capabilities": ["text", "vision", "chat", "function_calling", "streaming", "reasoning"],
        "context_window": 131072,
        "max_output": 8192,
        "input_price": 2.0,
        "output_price": 6.0,
        "is_active": True,
        "sort_order": 20,
    },
    {
        "id": "00000000-0000-0000-0000-000000000003",
        "model_id": "qwen3-max",
        "display_name": "Qwen3 Max",
        "provider": "alibaba",
        "category": "llm",
        "description": "通义千问 3 Max，旗舰级推理能力，支持视觉输入，适合高难度分析与创作任务。",
        "capabilities": ["text", "vision", "chat", "function_calling", "streaming", "reasoning", "long_context"],
        "context_window": 131072,
        "max_output": 8192,
        "input_price": 6.0,
        "output_price": 24.0,
        "is_active": True,
        "sort_order": 30,
    },
    {
        "id": "00000000-0000-0000-0000-000000000004",
        "model_id": "deepseek-v3.2",
        "display_name": "DeepSeek V3.2",
        "provider": "deepseek",
        "category": "llm",
        "description": "DeepSeek V3.2，强大的开源大模型，性价比高，适合多种场景。",
        "capabilities": ["text", "chat", "function_calling", "streaming", "reasoning"],
        "context_window": 65536,
        "max_output": 8192,
        "input_price": 1.0,
        "output_price": 2.0,
        "is_active": True,
        "sort_order": 40,
    },
    {
        "id": "00000000-0000-0000-0000-000000000005",
        "model_id": "deepseek-r1",
        "display_name": "DeepSeek R1",
        "provider": "deepseek",
        "category": "llm",
        "description": "DeepSeek R1，专注深度推理，适合数学、编程与逻辑分析任务。",
        "capabilities": ["text", "chat", "streaming", "reasoning", "chain_of_thought"],
        "context_window": 65536,
        "max_output": 8192,
        "input_price": 4.0,
        "output_price": 16.0,
        "is_active": True,
        "sort_order": 50,
    },
    {
        "id": "00000000-0000-0000-0000-000000000006",
        "model_id": "paraformer-v2",
        "display_name": "Paraformer V2",
        "provider": "alibaba",
        "category": "asr",
        "description": "高精度语音识别模型，支持中英文混合识别，适合实时转写场景。",
        "capabilities": ["realtime", "chinese", "english", "punctuation"],
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
        "display_name": "SenseVoice V1",
        "provider": "alibaba",
        "category": "asr",
        "description": "多语种语音理解模型，支持情感识别与语种检测。",
        "capabilities": ["multilingual", "emotion", "language_detection", "punctuation"],
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
        "display_name": "CosyVoice V1",
        "provider": "alibaba",
        "category": "tts",
        "description": "自然流畅的语音合成模型，支持多种音色和情感表达。",
        "capabilities": ["chinese", "english", "multi_speaker", "emotion"],
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
        "display_name": "Sambert V1",
        "provider": "alibaba",
        "category": "tts",
        "description": "高品质语音合成模型，发音清晰自然，适合客服与播报场景。",
        "capabilities": ["chinese", "high_quality", "multi_speaker"],
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
        "display_name": "Qwen VL Plus",
        "provider": "alibaba",
        "category": "vision",
        "description": "通义千问视觉理解模型 Plus，支持图片理解、OCR 与视觉问答。",
        "capabilities": ["vision", "ocr", "image_understanding", "visual_qa"],
        "context_window": 8192,
        "max_output": 2048,
        "input_price": 2.0,
        "output_price": 6.0,
        "is_active": True,
        "sort_order": 10,
    },
    {
        "id": "00000000-0000-0000-0000-000000000011",
        "model_id": "qwen-vl-max",
        "display_name": "Qwen VL Max",
        "provider": "alibaba",
        "category": "vision",
        "description": "通义千问视觉理解旗舰模型，适合复杂图像与文档分析。",
        "capabilities": ["vision", "ocr", "image_understanding", "visual_qa", "document_analysis"],
        "context_window": 8192,
        "max_output": 2048,
        "input_price": 6.0,
        "output_price": 24.0,
        "is_active": True,
        "sort_order": 20,
    },
    {
        "id": "00000000-0000-0000-0000-000000000012",
        "model_id": "qwen3-omni-flash-realtime",
        "display_name": "Qwen3 Omni Flash Realtime",
        "provider": "alibaba",
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
