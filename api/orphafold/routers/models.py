"""GET /models: registered model providers and whether each can run on this deployment."""

import asyncio

from fastapi import APIRouter

from orphafold.errors import PROBLEM_RESPONSES, NotFound
from orphafold.providers.base import ProviderInfo, all_providers, get_provider
from orphafold.schemas.common import Schema

router = APIRouter(prefix="/models", tags=["models"], responses=PROBLEM_RESPONSES)


class ModelsResponse(Schema):
    providers: list[ProviderInfo]


@router.get("", response_model=ModelsResponse, summary="Model providers, capabilities and availability")
async def list_models() -> ModelsResponse:
    providers = await asyncio.gather(*(provider.describe() for provider in all_providers()))
    return ModelsResponse(providers=list(providers))


@router.get("/{provider_id}", response_model=ProviderInfo, summary="One model provider")
async def get_model(provider_id: str) -> ProviderInfo:
    provider = get_provider(provider_id)
    if provider is None:
        raise NotFound(f"No model provider with ID '{provider_id}'.", code="provider_not_found")
    return await provider.describe()
