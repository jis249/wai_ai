import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Banner } from '../components/ui/Banner'
import { CopyButton } from '../components/ui/CopyButton'
import { Select } from '../components/ui/Select'
import TabSwitcher from '../components/ui/TabSwitcher'
import { ArrowRight, ExternalLink } from '../components/ui/icons'
import { useAvailableModels } from '../hooks/useAvailableModels'
import { resolveProxyBaseUrl } from '../lib/proxyUrl'

const KEY = 'YOUR_WAI_API_KEY'

type ToolKey = 'cursor' | 'vscode' | 'continue' | 'cline' | 'claude-code'

const TOOLS: { key: ToolKey; label: string }[] = [
  { key: 'cursor', label: 'Cursor' },
  { key: 'vscode', label: 'VS Code (Copilot)' },
  { key: 'continue', label: 'Continue' },
  { key: 'cline', label: 'Cline / Roo Code' },
  { key: 'claude-code', label: 'Claude Code' },
]

const linkButton =
  'inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary no-underline transition-colors hover:bg-bg-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'

function Code({ text, label }: { text: string; label: string }) {
  return (
    <div className="mt-2 min-w-0">
      <div className="mb-1 flex justify-end">
        <CopyButton text={text} aria-label={`Copy ${label}`} />
      </div>
      <pre className="max-h-96 overflow-auto rounded-md bg-bg-tertiary p-3 font-mono text-xs text-text-secondary">
        <code>{text}</code>
      </pre>
    </div>
  )
}

function Value({ text }: { text: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 align-middle">
      <code className="truncate rounded bg-bg-tertiary px-1.5 py-0.5 font-mono text-xs text-text-primary">{text}</code>
      <CopyButton text={text} aria-label={`Copy ${text}`} />
    </span>
  )
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-3 pl-5 text-sm text-text-secondary marker:text-text-tertiary">{children}</ol>
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-text-tertiary">{children}</p>
}

interface GuideProps {
  baseUrl: string
  origin: string
  model: string
  chatModels: string[]
  embeddingModel: string
}

function CursorGuide({ baseUrl, model, chatModels }: GuideProps) {
  return (
    <div className="space-y-4">
      <Steps>
        <li>Open Cursor <strong>Settings</strong> (Ctrl/Cmd + Shift + J) and go to <strong>Models</strong>.</li>
        <li>Under <strong>API Keys</strong>, paste your WAI key into <strong>OpenAI API Key</strong>.</li>
        <li>Turn on <strong>Override OpenAI Base URL</strong> and enter <Value text={baseUrl} /></li>
        <li>
          Click <strong>+ Add Custom Model</strong> and type the model name exactly, e.g. <Value text={model} />
          {chatModels.length > 1 && <> Repeat for any other model you want: {chatModels.filter((m) => m !== model).join(', ')}.</>}
        </li>
        <li>Click <strong>Verify</strong>, then pick the model from the model dropdown in Chat or Agent.</li>
      </Steps>
      <Note>
        Cursor sends these requests from its own servers, so the base URL must be reachable from the internet (it is when
        you use the address above). Tab autocomplete keeps using Cursor's built-in models. While the override is on,
        every OpenAI model enabled in Cursor is routed to WAI, so turn off built-in OpenAI models you do not want.
      </Note>
    </div>
  )
}

function VSCodeGuide({ baseUrl, model }: GuideProps) {
  const json = `[
  {
    "name": "WAI",
    "vendor": "customendpoint",
    "apiKey": "\${input:waiApiKey}",
    "apiType": "chat-completions",
    "models": [
      {
        "id": "${model}",
        "name": "WAI ${model}",
        "url": "${baseUrl}/chat/completions",
        "toolCalling": true,
        "vision": false,
        "maxInputTokens": 128000,
        "maxOutputTokens": 16000
      }
    ]
  }
]`
  return (
    <div className="space-y-4">
      <Steps>
        <li>Install or update VS Code and the <strong>GitHub Copilot Chat</strong> extension to the latest version.</li>
        <li>
          Open the Chat view, click the model picker and choose <strong>Manage Models</strong> (or run{' '}
          <strong>Chat: Manage Language Models</strong> from the Command Palette).
        </li>
        <li>Choose <strong>Add Models</strong> → <strong>Custom Endpoint</strong> → <strong>Chat Completions</strong>.</li>
        <li>
          VS Code opens <code className="font-mono text-xs">chatLanguageModels.json</code>. Paste the entry below; add one
          object to <code className="font-mono text-xs">models</code> per model you want.
          <Code text={json} label="VS Code model configuration" />
        </li>
        <li>Save, enter your WAI key when prompted, and select <strong>WAI {model}</strong> in the chat model picker. Restart VS Code if it does not appear.</li>
      </Steps>
      <Note>
        Older Copilot versions call this provider <strong>OpenAI Compatible</strong> instead of Custom Endpoint; the base URL,
        key and model name are the same. If your Copilot plan is managed by an organization, an admin may need to allow
        bring-your-own-key models. Inline completions keep using Copilot's own models.
      </Note>
    </div>
  )
}

function ContinueGuide({ baseUrl, chatModels, model, embeddingModel }: GuideProps) {
  const chatEntries = (chatModels.length ? chatModels : [model])
    .map(
      (m) => `  - name: WAI ${m}
    provider: openai
    model: ${m}
    apiBase: ${baseUrl}
    apiKey: ${KEY}
    roles: [chat, edit, apply]`,
    )
    .join('\n')
  const embedEntry = embeddingModel
    ? `
  - name: WAI embeddings
    provider: openai
    model: ${embeddingModel}
    apiBase: ${baseUrl}
    apiKey: ${KEY}
    roles: [embed]`
    : ''
  const yaml = `name: WAI
version: 1.0.0
schema: v1
models:
${chatEntries}${embedEntry}`
  return (
    <div className="space-y-4">
      <Steps>
        <li>Install the <strong>Continue</strong> extension (VS Code or JetBrains).</li>
        <li>
          Open Continue, click the gear icon and open your config, or edit{' '}
          <code className="font-mono text-xs">~/.continue/config.yaml</code> directly.
        </li>
        <li>
          Replace its contents (or merge the <code className="font-mono text-xs">models</code> list) with:
          <Code text={yaml} label="Continue config" />
        </li>
        <li>Replace <code className="font-mono text-xs">{KEY}</code> with your key, save, and pick a WAI model in the Continue chat.</li>
      </Steps>
    </div>
  )
}

function ClineGuide({ baseUrl, model }: GuideProps) {
  return (
    <div className="space-y-4">
      <Steps>
        <li>Install <strong>Cline</strong> or <strong>Roo Code</strong> from the VS Code (or Cursor) extensions marketplace.</li>
        <li>Open the extension and click the settings (gear) icon.</li>
        <li>Set <strong>API Provider</strong> to <strong>OpenAI Compatible</strong>.</li>
        <li>Base URL: <Value text={baseUrl} /></li>
        <li>API Key: your WAI key.</li>
        <li>Model ID: <Value text={model} /></li>
        <li>Save and start a task.</li>
      </Steps>
      <Note>Choose a model that supports tool calling; agentic extensions rely on it.</Note>
    </div>
  )
}

function ClaudeCodeGuide({ origin, model }: GuideProps) {
  const settings = `{
  "env": {
    "ANTHROPIC_BASE_URL": "${origin}",
    "ANTHROPIC_AUTH_TOKEN": "${KEY}",
    "ANTHROPIC_MODEL": "${model}",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "${model}"
  }
}`
  return (
    <div className="space-y-4">
      <Steps>
        <li>Install Claude Code (CLI, or the Claude Code extension for VS Code / Cursor).</li>
        <li>
          Add this to <code className="font-mono text-xs">~/.claude/settings.json</code> (on Windows{' '}
          <code className="font-mono text-xs">%USERPROFILE%\.claude\settings.json</code>):
          <Code text={settings} label="Claude Code settings" />
        </li>
        <li>Replace <code className="font-mono text-xs">{KEY}</code> with your key and restart Claude Code.</li>
      </Steps>
      <Note>
        WAI speaks the Anthropic Messages API, so the base URL is the site address without <code>/v1</code>. Requests use
        your WAI models and count toward your WAI usage and limits.
      </Note>
    </div>
  )
}

const GUIDES: Record<ToolKey, (p: GuideProps) => React.ReactElement> = {
  cursor: CursorGuide,
  vscode: VSCodeGuide,
  continue: ContinueGuide,
  cline: ClineGuide,
  'claude-code': ClaudeCodeGuide,
}

/** /integrations: step-by-step setup for editors and coding agents against the WAI gateway. */
export default function IntegrationsPage() {
  const [tool, setTool] = useState<ToolKey>('cursor')
  const { data, isLoading } = useAvailableModels()
  const baseUrl = resolveProxyBaseUrl().replace(/\/$/, '')
  const origin = baseUrl.replace(/\/v1$/, '')

  const chatModels = useMemo(
    () => (data?.models ?? []).filter((m) => m.type === 'chat' && m.name !== 'auto').map((m) => m.name),
    [data],
  )
  const embeddingModel = useMemo(() => (data?.models ?? []).find((m) => m.type === 'embedding')?.name ?? '', [data])
  const [picked, setPicked] = useState('')
  const model = chatModels.includes(picked) ? picked : (chatModels[0] ?? 'MODEL_NAME')

  const testCmd = `curl ${baseUrl}/models -H "Authorization: Bearer ${KEY}"`
  const Guide = GUIDES[tool]

  return (
    <div>
      <PageHeader
        title="Connect your editor"
        description="Use WAI models in Cursor, VS Code and coding agents. Usage, limits and access rules apply as usual."
      />

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-text-primary">Before you start</h2>
        <Steps>
          <li>
            <span className="mr-2">Create a personal API key and copy it (it is shown once).</span>
            <Link to="/keys" className={linkButton}>
              Go to API access <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </li>
          <li>OpenAI-compatible base URL: <Value text={baseUrl} /></li>
          <li>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span>Pick the model to use in the snippets below:</span>
              {chatModels.length > 0 ? (
                <div className="w-full sm:w-72">
                  <Select value={model} onChange={setPicked} options={chatModels.map((m) => ({ value: m, label: m }))} searchable fullWidth />
                </div>
              ) : (
                <span className="text-text-tertiary">{isLoading ? 'Loading…' : 'none'}</span>
              )}
            </div>
          </li>
          <li>
            Optional: check your key works.
            <Code text={testCmd} label="test command" />
          </li>
        </Steps>
        {!isLoading && chatModels.length === 0 && (
          <Banner
            variant="warning"
            className="mt-4"
            title="You do not have access to any chat models yet. Ask your organization admin to grant model access."
          />
        )}
      </Card>

      <TabSwitcher tabs={TOOLS} activeKey={tool} onChange={(k) => setTool(k as ToolKey)} />

      <Card>
        <Guide baseUrl={baseUrl} origin={origin} model={model} chatModels={chatModels} embeddingModel={embeddingModel} />
      </Card>

      <p className="mt-4 flex items-center gap-1 text-xs text-text-tertiary">
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        Editors change their settings screens often; if a menu name differs, look for "custom model", "OpenAI compatible" or "base URL".
      </p>
    </div>
  )
}
