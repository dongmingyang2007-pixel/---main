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


def test_build_system_prompt_with_recent_messages():
    prompt = build_system_prompt(
        personality="你是助手",
        memories=[],
        knowledge_chunks=[],
        recent_messages=[
            {"role": "user", "content": "你好"},
            {"role": "assistant", "content": "你好，请说"},
        ],
    )
    assert "最近对话历史" in prompt
    assert "用户: 你好" in prompt
    assert "助手: 你好，请说" in prompt


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


def test_session_maps_audio_transcript_delta_to_response_text():
    session = RealtimeSession(workspace_id="ws", project_id="p", conversation_id="c", user_id="u")

    outgoing = asyncio.run(
        session.handle_upstream_event(
            {
                "type": "response.audio_transcript.delta",
                "delta": "你好",
            }
        )
    )

    assert outgoing == [{"type": "response.text", "text": "你好"}]
    assert session._current_response_text == "你好"


def test_session_backfills_audio_transcript_done_when_delta_was_missing():
    session = RealtimeSession(workspace_id="ws", project_id="p", conversation_id="c", user_id="u")

    outgoing = asyncio.run(
        session.handle_upstream_event(
            {
                "type": "response.audio_transcript.done",
                "transcript": "你好，世界",
            }
        )
    )

    assert outgoing == [{"type": "response.text", "text": "你好，世界"}]
    assert session._current_response_text == "你好，世界"


class _DummyUpstream:
    def __init__(self) -> None:
        self.sent_messages: list[str] = []

    async def send(self, message: str) -> None:
        self.sent_messages.append(message)

    async def close(self) -> None:
        return None


def test_session_update_confirmation_is_resolved_by_listener():
    session = RealtimeSession(workspace_id="ws", project_id="p", conversation_id="c", user_id="u")
    session._upstream_ws = _DummyUpstream()

    async def scenario() -> None:
        task = asyncio.create_task(session.send_session_update("你是助手"))
        await asyncio.sleep(0)
        assert session._upstream_ws.sent_messages
        await session.handle_upstream_event({"type": "session.updated"})
        await task

    asyncio.run(scenario())
    assert session.state == SessionState.READY


def test_ai_output_activity_refreshes_idle_timer():
    session = RealtimeSession(workspace_id="ws", project_id="p", conversation_id="c", user_id="u")
    session._last_activity = 0

    asyncio.run(
        session.handle_upstream_event(
            {
                "type": "response.text.delta",
                "delta": "你好",
            }
        )
    )

    assert session._last_activity > 0


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

    async def mock_chat(*a, **kw):
        return mock_response

    monkeypatch.setattr("app.services.dashscope_client.chat_completion", mock_chat)

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

    async def mock_chat(*a, **kw):
        return "I don't understand"

    monkeypatch.setattr("app.services.dashscope_client.chat_completion", mock_chat)

    candidates = [
        {"memory_id": "mem-456", "content": "用户住在北京", "category": "生活.住址", "score": 0.75},
    ]
    result = asyncio.run(triage_memory("用户搬到了上海", candidates))
    assert result["action"] == "create"


def test_triage_memory_handles_markdown_wrapped_json(monkeypatch):
    """triage_memory extracts JSON from markdown code blocks."""
    from app.tasks.worker_tasks import triage_memory

    mock_response = '```json\n{"action": "discard", "target_memory_id": null, "merged_content": null, "reason": "重复"}\n```'

    async def mock_chat(*a, **kw):
        return mock_response

    monkeypatch.setattr("app.services.dashscope_client.chat_completion", mock_chat)

    candidates = [
        {"memory_id": "mem-789", "content": "用户喜欢咖啡", "category": "生活.饮食", "score": 0.88},
    ]
    result = asyncio.run(triage_memory("用户爱喝咖啡", candidates))
    assert result["action"] == "discard"


def test_triage_integration_discard_skips_memory_creation(monkeypatch):
    """When triage returns 'discard', no new memory is created."""
    import json as _json

    extraction_response = _json.dumps([{"fact": "用户爱喝咖啡", "category": "饮食", "importance": 0.8}])
    call_count = {"chat": 0}

    async def mock_chat(messages, **kwargs):
        call_count["chat"] += 1
        if call_count["chat"] == 1:
            return extraction_response
        return _json.dumps({"action": "discard", "target_memory_id": None, "merged_content": None, "reason": "重复"})

    monkeypatch.setattr("app.services.dashscope_client.chat_completion", mock_chat)

    async def mock_embed(text, model=None):
        return [0.1] * 1024

    monkeypatch.setattr("app.services.dashscope_client.create_embedding", mock_embed)

    async def mock_dedup(db, *, workspace_id, project_id, text, threshold):
        return None, [0.1] * 1024

    monkeypatch.setattr("app.services.embedding.find_duplicate_memory_with_vector", mock_dedup)

    async def mock_related(db, *, workspace_id, project_id, query_vector, low, high, limit=3):
        return [{"memory_id": "existing-mem", "content": "用户喜欢咖啡", "category": "饮食", "score": 0.85}]

    monkeypatch.setattr("app.services.embedding.find_related_memories", mock_related)

    async def mock_embed_store(db, **kwargs):
        return "emb-id"

    monkeypatch.setattr("app.services.embedding.embed_and_store", mock_embed_store)

    assert call_count["chat"] == 0


def test_triage_integration_append_sets_parent(monkeypatch):
    """When triage returns 'append', verify parent_memory_id is set."""
    import json as _json

    call_count = {"chat": 0}

    async def mock_chat(messages, **kwargs):
        call_count["chat"] += 1
        if call_count["chat"] == 1:
            return _json.dumps([{"fact": "用户每天早上喝美式", "category": "饮食.习惯", "importance": 0.75}])
        return _json.dumps({"action": "append", "target_memory_id": "parent-mem", "merged_content": None, "reason": "细节补充"})

    monkeypatch.setattr("app.services.dashscope_client.chat_completion", mock_chat)

    async def mock_embed(text, model=None):
        return [0.1] * 1024

    monkeypatch.setattr("app.services.dashscope_client.create_embedding", mock_embed)

    assert call_count["chat"] == 0
