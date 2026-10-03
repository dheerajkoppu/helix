"""Error model: every non-2xx response is RFC 9457 problem JSON (application/problem+json)."""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from starlette.exceptions import HTTPException as StarletteHTTPException

from orphafold.log import get_logger

logger = get_logger(__name__)

PROBLEM_MEDIA_TYPE = "application/problem+json"
PROBLEM_TYPE_PREFIX = "urn:orphafold:problem:"


class FieldProblem(BaseModel):
    location: list[str | int]
    message: str
    type: str | None = None


class ProblemDetail(BaseModel):
    """Body of every error response."""

    model_config = ConfigDict(extra="allow")

    type: str
    title: str
    status: int
    code: str
    detail: str | None = None
    instance: str | None = None
    errors: list[FieldProblem] | None = None
    source: str | None = None


class ApiError(Exception):
    status_code: int = 500
    code: str = "internal_error"
    title: str = "Internal error"

    def __init__(
        self,
        detail: str | None = None,
        *,
        code: str | None = None,
        title: str | None = None,
        status_code: int | None = None,
        headers: dict[str, str] | None = None,
        **extra: Any,
    ) -> None:
        super().__init__(detail or title or self.title)
        self.detail = detail
        if code is not None:
            self.code = code
        if title is not None:
            self.title = title
        if status_code is not None:
            self.status_code = status_code
        self.headers = headers
        self.extra = extra


class BadRequest(ApiError):
    status_code = 400
    code = "bad_request"
    title = "Bad request"


class WorkspaceRequired(ApiError):
    status_code = 400
    code = "workspace_required"
    title = "Workspace identity required"


class Forbidden(ApiError):
    status_code = 403
    code = "forbidden"
    title = "Forbidden"


class NotFound(ApiError):
    status_code = 404
    code = "not_found"
    title = "Not found"


class Conflict(ApiError):
    status_code = 409
    code = "conflict"
    title = "Conflict"


class ValidationFailed(ApiError):
    status_code = 422
    code = "validation_error"
    title = "Validation failed"


class NotConfigured(ApiError):
    """A feature exists but this deployment has not configured it (missing key, executable, URL)."""

    status_code = 503
    code = "not_configured"
    title = "Not configured"

    def __init__(self, feature: str, detail: str | None = None, *, setting: str | None = None) -> None:
        hint = f" Set {setting} to enable it." if setting else ""
        super().__init__(detail or f"{feature} is not configured on this deployment.{hint}")
        self.extra = {"feature": feature, "setting": setting}


class DisabledByLicense(ApiError):
    """The source is restricted to non-commercial use and the deployment has not enabled it."""

    status_code = 403
    code = "disabled_by_license"
    title = "Disabled by license"

    def __init__(self, source: str, detail: str | None = None) -> None:
        super().__init__(
            detail
            or f"{source} is restricted to non-commercial use. "
            "Set ORPHAFOLD_ENABLE_NONCOMMERCIAL_SOURCES=true to enable it."
        )
        self.extra = {"source": source}


class SourceUnavailable(ApiError):
    """An upstream source this endpoint cannot do without did not answer."""

    status_code = 502
    code = "source_unavailable"
    title = "Source temporarily unavailable"

    def __init__(self, source: str, detail: str | None = None) -> None:
        super().__init__(detail or f"{source} is temporarily unavailable.")
        self.extra = {"source": source}


def problem_response(
    request: Request | None,
    *,
    status_code: int,
    code: str,
    title: str,
    detail: str | None = None,
    headers: dict[str, str] | None = None,
    **extra: Any,
) -> JSONResponse:
    body: dict[str, Any] = {
        "type": PROBLEM_TYPE_PREFIX + code,
        "title": title,
        "status": status_code,
        "code": code,
        "detail": detail,
        "instance": request.url.path if request is not None else None,
    }
    body.update({key: value for key, value in extra.items() if value is not None})
    return JSONResponse(body, status_code=status_code, headers=headers, media_type=PROBLEM_MEDIA_TYPE)


_STATUS_CODES = {
    400: ("bad_request", "Bad request"),
    401: ("unauthorized", "Unauthorized"),
    403: ("forbidden", "Forbidden"),
    404: ("not_found", "Not found"),
    405: ("method_not_allowed", "Method not allowed"),
    409: ("conflict", "Conflict"),
    422: ("validation_error", "Validation failed"),
    429: ("rate_limited", "Too many requests"),
}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(request: Request, error: ApiError) -> JSONResponse:
        return problem_response(
            request,
            status_code=error.status_code,
            code=error.code,
            title=error.title,
            detail=error.detail,
            headers=error.headers,
            **error.extra,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, error: StarletteHTTPException) -> JSONResponse:
        code, title = _STATUS_CODES.get(error.status_code, ("http_error", "Request failed"))
        detail = error.detail if isinstance(error.detail, str) else None
        return problem_response(
            request,
            status_code=error.status_code,
            code=code,
            title=title,
            detail=detail,
            headers=getattr(error, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
        problems = [
            {"location": list(item.get("loc", ())), "message": item.get("msg", ""), "type": item.get("type")}
            for item in error.errors()
        ]
        return problem_response(
            request,
            status_code=422,
            code="validation_error",
            title="Validation failed",
            detail="The request did not match the expected shape.",
            errors=problems,
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, error: Exception) -> JSONResponse:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return problem_response(
            request,
            status_code=500,
            code="internal_error",
            title="Internal error",
            detail="The server failed to handle this request.",
        )


PROBLEM_RESPONSES: dict[int | str, dict[str, Any]] = {
    "4XX": {"model": ProblemDetail, "description": "Problem JSON"},
    "5XX": {"model": ProblemDetail, "description": "Problem JSON"},
}
