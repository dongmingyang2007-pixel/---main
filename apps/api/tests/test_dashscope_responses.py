import pytest

from app.services.dashscope_client import UpstreamServiceError
from app.services.dashscope_responses import _build_responses_payload, _parse_responses_result
from app.services.llm_tools import get_response_function_tools


def test_response_function_tools_use_openai_compatible_object_schema() -> None:
    tools_by_name = {tool["name"]: tool for tool in get_response_function_tools()}

    datetime_schema = tools_by_name["get_current_datetime"]["parameters"]
    assert datetime_schema["type"] == "object"
    assert datetime_schema["required"] == []
    assert datetime_schema["additionalProperties"] is False

    knowledge_schema = tools_by_name["search_project_knowledge"]["parameters"]
    assert knowledge_schema["required"] == ["query"]
    assert knowledge_schema["additionalProperties"] is False


def test_build_responses_payload_omits_tool_choice_without_tools() -> None:
    payload = _build_responses_payload(
        input_items=[{"role": "user", "content": "hello"}],
        model="qwen3-max",
        enable_thinking=False,
        tools=None,
        tool_choice="auto",
        stream=False,
    )

    assert "tool_choice" not in payload
    assert "tools" not in payload


def test_parse_responses_result_raises_for_failed_payload() -> None:
    with pytest.raises(
        UpstreamServiceError,
        match="server_error: <400> InternalError.Algo.InvalidParameter",
    ):
        _parse_responses_result(
            {
                "status": "failed",
                "error": {
                    "code": "server_error",
                    "message": (
                        "<400> InternalError.Algo.InvalidParameter: "
                        "The parameters, when provided as a dict, must confirm "
                        "to a valid openai-compatible JSON schema."
                    ),
                },
                "output": [],
            }
        )
