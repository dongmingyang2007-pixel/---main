"""Tests for real-time voice features."""
from app.core.config import Settings


def test_realtime_settings_defaults():
    s = Settings(
        database_url="postgresql+psycopg://x:x@localhost/test",
        jwt_secret="test-secret-that-is-long-enough-32chars",
    )
    assert s.realtime_interrupt_threshold_ms == 500
    assert s.realtime_idle_timeout_seconds == 60
    assert s.realtime_close_timeout_seconds == 120
    assert s.realtime_max_session_seconds == 1800
    assert s.realtime_max_concurrent_sessions == 50
    assert s.realtime_context_history_turns == 10
    assert s.realtime_rag_refresh_turns == 5
    assert s.realtime_reconnect_max_attempts == 3


def test_memory_triage_settings_defaults():
    s = Settings(
        database_url="postgresql+psycopg://x:x@localhost/test",
        jwt_secret="test-secret-that-is-long-enough-32chars",
    )
    assert s.memory_triage_model == "qwen-turbo"
    assert s.memory_triage_similarity_low == 0.70
    assert s.memory_triage_similarity_high == 0.90


from app.services.context_loader import (
    extract_personality,
    build_system_prompt,
)


def test_extract_personality_from_description():
    assert extract_personality("[personality:你是一个温柔的助手]") == "你是一个温柔的助手"


def test_extract_personality_fallback():
    assert extract_personality("Just a project") == "Just a project"


def test_extract_personality_none():
    assert extract_personality(None) == ""


def test_build_system_prompt_minimal():
    prompt = build_system_prompt(personality="你是助手", memories=[], knowledge_chunks=[])
    assert "你是助手" in prompt


def test_build_system_prompt_with_memories():
    prompt = build_system_prompt(
        personality="你是助手",
        memories=["用户喜欢跑步", "用户住在北京"],
        knowledge_chunks=[],
    )
    assert "用户喜欢跑步" in prompt
    assert "用户住在北京" in prompt


def test_build_system_prompt_with_knowledge():
    prompt = build_system_prompt(
        personality="你是助手",
        memories=[],
        knowledge_chunks=["降噪技术文档片段"],
    )
    assert "降噪技术文档片段" in prompt


import asyncio
import pytest
from app.services.realtime_bridge import RealtimeSession, SessionState, register_session, unregister_session


def test_session_initial_state():
    session = RealtimeSession(
        workspace_id="ws1",
        project_id="proj1",
        conversation_id="conv1",
        user_id="user1",
    )
    assert session.state == SessionState.CONNECTING
    assert session.turn_count == 0
    assert session.is_ai_speaking is False


def test_session_should_interrupt_short_speech():
    session = RealtimeSession(
        workspace_id="ws1",
        project_id="proj1",
        conversation_id="conv1",
        user_id="user1",
    )
    session._ai_speaking = True
    assert session.should_interrupt(speech_duration_ms=200) is False


def test_session_should_interrupt_long_speech():
    session = RealtimeSession(
        workspace_id="ws1",
        project_id="proj1",
        conversation_id="conv1",
        user_id="user1",
    )
    session._ai_speaking = True
    assert session.should_interrupt(speech_duration_ms=600) is True


def test_session_should_not_interrupt_when_ai_silent():
    session = RealtimeSession(
        workspace_id="ws1",
        project_id="proj1",
        conversation_id="conv1",
        user_id="user1",
    )
    session._ai_speaking = False
    assert session.should_interrupt(speech_duration_ms=600) is False


def test_register_session_blocks_duplicate_user():
    """One user cannot have two concurrent sessions."""
    from app.services.realtime_bridge import _active_sessions

    _active_sessions.clear()

    s1 = RealtimeSession(workspace_id="ws", project_id="p", conversation_id="c1", user_id="u1")
    s2 = RealtimeSession(workspace_id="ws", project_id="p", conversation_id="c2", user_id="u1")

    assert asyncio.run(register_session("u1", s1)) is True
    assert asyncio.run(register_session("u1", s2)) is False

    asyncio.run(unregister_session("u1"))
    assert asyncio.run(register_session("u1", s2)) is True
    asyncio.run(unregister_session("u1"))
    _active_sessions.clear()


def test_register_session_enforces_global_limit(monkeypatch):
    """Global concurrent session limit is enforced."""
    from app.services.realtime_bridge import _active_sessions

    _active_sessions.clear()

    monkeypatch.setattr("app.services.realtime_bridge.settings.realtime_max_concurrent_sessions", 2)

    s1 = RealtimeSession(workspace_id="ws", project_id="p", conversation_id="c1", user_id="u1")
    s2 = RealtimeSession(workspace_id="ws", project_id="p", conversation_id="c2", user_id="u2")
    s3 = RealtimeSession(workspace_id="ws", project_id="p", conversation_id="c3", user_id="u3")

    assert asyncio.run(register_session("u1", s1)) is True
    assert asyncio.run(register_session("u2", s2)) is True
    assert asyncio.run(register_session("u3", s3)) is False  # limit reached

    asyncio.run(unregister_session("u1"))
    asyncio.run(unregister_session("u2"))
    _active_sessions.clear()


def test_session_get_turn_texts():
    session = RealtimeSession(workspace_id="ws", project_id="p", conversation_id="c", user_id="u")
    session._current_transcript = "你好"
    session._current_response_text = "你好，有什么可以帮你的？"

    user_text, ai_text = session.get_turn_texts()
    assert user_text == "你好"
    assert ai_text == "你好，有什么可以帮你的？"
    # Should be cleared after retrieval
    assert session._current_transcript == ""
    assert session._current_response_text == ""


import json


def test_triage_memory_parses_merge_response(monkeypatch):
    """triage_memory correctly parses a merge decision from LLM."""
    from app.tasks.worker_tasks import triage_memory

    mock_response = json.dumps({
        "action": "merge",
        "target_memory_id": "mem-123",
        "merged_content": "用户是前端工程师，使用Vue和React",
        "reason": "补充了技术栈细节",
    })
    monkeypatch.setattr(
        "app.services.dashscope_client.chat_completion",
        lambda *a, **kw: asyncio.coroutine(lambda: mock_response)(),
    )

    candidates = [
        {"memory_id": "mem-123", "content": "用户是前端工程师", "category": "工作.职业", "score": 0.82},
    ]
    result = asyncio.run(triage_memory("用户是前端工程师，使用Vue和React", candidates))
    assert result["action"] == "merge"
    assert result["target_memory_id"] == "mem-123"
    assert "Vue" in result["merged_content"]


def test_triage_memory_fallback_on_bad_json(monkeypatch):
    """triage_memory returns create fallback when LLM returns unparseable response."""
    from app.tasks.worker_tasks import triage_memory

    monkeypatch.setattr(
        "app.services.dashscope_client.chat_completion",
        lambda *a, **kw: asyncio.coroutine(lambda: "I don't understand")(),
    )

    candidates = [
        {"memory_id": "mem-456", "content": "用户住在北京", "category": "生活.住址", "score": 0.75},
    ]
    result = asyncio.run(triage_memory("用户搬到了上海", candidates))
    assert result["action"] == "create"


def test_triage_memory_handles_markdown_wrapped_json(monkeypatch):
    """triage_memory extracts JSON from markdown code blocks."""
    from app.tasks.worker_tasks import triage_memory

    mock_response = '```json\n{"action": "discard", "target_memory_id": null, "merged_content": null, "reason": "重复"}\n```'
    monkeypatch.setattr(
        "app.services.dashscope_client.chat_completion",
        lambda *a, **kw: asyncio.coroutine(lambda: mock_response)(),
    )

    candidates = [
        {"memory_id": "mem-789", "content": "用户喜欢咖啡", "category": "生活.饮食", "score": 0.88},
    ]
    result = asyncio.run(triage_memory("用户爱喝咖啡", candidates))
    assert result["action"] == "discard"
