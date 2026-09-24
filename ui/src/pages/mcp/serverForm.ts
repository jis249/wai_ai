import type {
  CreateMCPServerParams,
  MCPServerResponse,
  UpdateMCPServerParams,
} from '../../hooks/useMCPServers'

export interface ServerFormState {
  name: string
  alias: string
  url: string
  authType: string
  authToken: string
  authHeader: string
  oauthTokenUrl: string
  oauthClientId: string
  oauthClientSecret: string
  oauthScopes: string
}

export interface ServerFormErrors {
  name?: string
  alias?: string
  url?: string
  auth_header?: string
  team?: string
}

export const EMPTY_SERVER_FORM: ServerFormState = {
  name: '',
  alias: '',
  url: '',
  authType: 'none',
  authToken: '',
  authHeader: '',
  oauthTokenUrl: '',
  oauthClientId: '',
  oauthClientSecret: '',
  oauthScopes: '',
}

export function validateServerForm(form: ServerFormState): ServerFormErrors {
  const next: ServerFormErrors = {}
  if (!form.name.trim()) next.name = 'Name is required'
  if (!form.alias.trim()) next.alias = 'Alias is required'
  if (!form.url.trim()) next.url = 'URL is required'
  if (form.authType === 'header' && !form.authHeader.trim()) {
    next.auth_header = 'Header name is required for custom header auth'
  }
  return next
}

export function buildCreateParams(form: ServerFormState): CreateMCPServerParams {
  const params: CreateMCPServerParams = {
    name: form.name.trim(),
    alias: form.alias.trim(),
    url: form.url.trim(),
    auth_type: form.authType,
  }
  if ((form.authType === 'bearer' || form.authType === 'header') && form.authToken.trim()) {
    params.auth_token = form.authToken.trim()
  }
  if (form.authType === 'header' && form.authHeader.trim()) params.auth_header = form.authHeader.trim()
  if (form.authType === 'oauth') {
    if (form.oauthTokenUrl.trim()) params.oauth_token_url = form.oauthTokenUrl.trim()
    if (form.oauthClientId.trim()) params.oauth_client_id = form.oauthClientId.trim()
    if (form.oauthClientSecret.trim()) params.oauth_client_secret = form.oauthClientSecret.trim()
    if (form.oauthScopes.trim()) params.oauth_scopes = form.oauthScopes.trim()
  }
  return params
}

export function formFromServer(server: MCPServerResponse): ServerFormState {
  return {
    name: server.name,
    alias: server.alias,
    url: server.url,
    authType: server.auth_type,
    authToken: '',
    authHeader: server.auth_header ?? '',
    oauthTokenUrl: server.oauth_token_url ?? '',
    oauthClientId: server.oauth_client_id ?? '',
    oauthClientSecret: '',
    oauthScopes: server.oauth_scopes ?? '',
  }
}

/** Only the fields that changed (same payload rules as before the split). */
export function buildUpdateParams(server: MCPServerResponse, form: ServerFormState): UpdateMCPServerParams {
  const params: UpdateMCPServerParams = {}
  const { authType } = form
  if (form.name.trim() !== server.name) params.name = form.name.trim()
  if (form.alias.trim() !== server.alias) params.alias = form.alias.trim()
  if (form.url.trim() !== server.url) params.url = form.url.trim()
  if (authType !== server.auth_type) params.auth_type = authType
  if ((authType === 'bearer' || authType === 'header') && form.authToken.trim()) {
    params.auth_token = form.authToken.trim()
  }
  if (authType === 'header' && form.authHeader.trim() !== (server.auth_header ?? '')) {
    params.auth_header = form.authHeader.trim() || undefined
  }
  if (authType === 'oauth') {
    if (form.oauthTokenUrl.trim() !== (server.oauth_token_url ?? '')) {
      params.oauth_token_url = form.oauthTokenUrl.trim() || undefined
    }
    if (form.oauthClientId.trim() !== (server.oauth_client_id ?? '')) {
      params.oauth_client_id = form.oauthClientId.trim() || undefined
    }
    if (form.oauthClientSecret.trim()) params.oauth_client_secret = form.oauthClientSecret.trim()
    if (form.oauthScopes.trim() !== (server.oauth_scopes ?? '')) {
      params.oauth_scopes = form.oauthScopes.trim() || undefined
    }
  }
  return params
}
