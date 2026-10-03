import time
from typing import Any

import httpx

from helix_lab_tools.context import LabToolError, api_url

RETRY_STATUSES = {502, 503, 504}
API_PREFIX = "/api/v1"


def request_json(
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 90.0,
) -> Any:
    if path.startswith("http"):
        url = path
    elif path.startswith(API_PREFIX):
        url = f"{api_url()}{path}"
    else:
        url = f"{api_url()}{API_PREFIX}{path}"
    cleaned = {key: value for key, value in (params or {}).items() if value is not None}
    # The API reloads when another builder saves a file, so one retry covers the restart
    for attempt in (1, 2):
        try:
            response = httpx.request(
                method,
                url,
                params=cleaned,
                json=body,
                headers=headers,
                timeout=timeout,
                follow_redirects=True,
            )
        except httpx.HTTPError as error:
            if attempt == 1:
                time.sleep(3)
                continue
            raise LabToolError(f"{method} {url} did not answer: {type(error).__name__}") from error
        if response.status_code in RETRY_STATUSES and attempt == 1:
            time.sleep(3)
            continue
        if response.status_code >= 400:
            raise LabToolError(f"{method} {url} answered HTTP {response.status_code}: {_detail(response)}")
        try:
            return response.json()
        except ValueError as error:
            raise LabToolError(f"{method} {url} did not return JSON.") from error
    raise LabToolError(f"{method} {url} failed.")


def get_json(path: str, params: dict[str, Any] | None = None, *, timeout: float = 90.0) -> Any:
    return request_json("GET", path, params=params, timeout=timeout)


def _detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text[:200]
    if isinstance(payload, dict):
        return str(payload.get("detail") or payload.get("title") or payload)[:300]
    return str(payload)[:300]
