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
from app.services.realtime_bridge import RealtimeSession, SessionState


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
