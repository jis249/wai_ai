import { useId } from 'react'
import { Link } from 'react-router-dom'
import { Input } from '../../components/ui/Input'
import { Textarea } from '../../components/ui/Textarea'
import { Select } from '../../components/ui/Select'
import type { SelectOption } from '../../components/ui/Select'
import { Toggle } from '../../components/ui/Toggle'
import { Skeleton } from '../../components/ui/Skeleton'
import { errorMessage } from '../../lib/errors'

export type PlaygroundMode = 'chat' | 'embedding'

export interface ParametersValue {
  systemPrompt: string
  temperature: number
  maxTokens: number
  stream: boolean
  apiKey: string
}

interface ParametersPanelProps {
  mode: PlaygroundMode
  modelOptions: SelectOption[]
  model: string
  onModelChange: (model: string) => void
  modelsLoading: boolean
  modelsError: unknown
  onRetryModels: () => void
  value: ParametersValue
  onChange: (patch: Partial<ParametersValue>) => void
  disabled?: boolean
}

const labelClass = 'block text-[10px] font-medium uppercase tracking-widest text-text-tertiary mb-1.5'

export function ParametersPanel({
  mode,
  modelOptions,
  model,
  onModelChange,
  modelsLoading,
  modelsError,
  onRetryModels,
  value,
  onChange,
  disabled = false,
}: ParametersPanelProps) {
  const ids = {
    model: useId(),
    system: useId(),
    temp: useId(),
    maxTokens: useId(),
    stream: useId(),
  }
  const isChat = mode === 'chat'

  return (
    <div className="space-y-5">
      <div className="relative z-20">
        <p id={ids.model} className={labelClass}>
          Model
        </p>
        {modelsError ? (
          <p className="text-xs text-error" role="alert">
            Couldn&apos;t load models: {errorMessage(modelsError)}{' '}
            <button type="button" className="underline" onClick={onRetryModels}>
              Retry
            </button>
          </p>
        ) : modelsLoading ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <div aria-labelledby={ids.model} role="group">
            <Select
              options={modelOptions}
              value={model}
              onChange={onModelChange}
              placeholder={modelOptions.length === 0 ? 'No models available' : 'Select a model...'}
              searchable={modelOptions.length > 8}
              disabled={modelOptions.length === 0}
              fullWidth
            />
          </div>
        )}
        {!modelsLoading && !modelsError && modelOptions.length === 0 && (
          <p className="mt-2 text-xs leading-relaxed text-text-tertiary">
            No {isChat ? 'chat' : 'embedding'} models are allowed for your org. An admin must grant access under{' '}
            <Link to="/models" className="text-accent hover:underline">
              Models → Access
            </Link>
            .
          </p>
        )}
      </div>

      {isChat && (
        <>
          <div className="flex items-center justify-between gap-3">
            <span id={ids.stream} className="text-[10px] font-medium uppercase tracking-widest text-text-tertiary">
              Stream response
            </span>
            <Toggle
              checked={value.stream}
              onChange={(stream) => onChange({ stream })}
              size="sm"
              aria-labelledby={ids.stream}
              disabled={disabled}
            />
          </div>

          <div>
            <label htmlFor={ids.system} className={labelClass}>
              System prompt
            </label>
            <Textarea
              id={ids.system}
              value={value.systemPrompt}
              onChange={(e) => onChange({ systemPrompt: e.target.value })}
              placeholder="You are a helpful assistant."
              rows={4}
              className="font-mono text-xs"
              disabled={disabled}
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor={ids.temp} className="text-[10px] font-medium uppercase tracking-widest text-text-tertiary">
                Temperature
              </label>
              <span className="rounded-full bg-accent/15 px-2 py-0.5 font-mono text-xs text-accent">
                {value.temperature.toFixed(1)}
              </span>
            </div>
            <input
              id={ids.temp}
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={value.temperature}
              onChange={(e) => onChange({ temperature: parseFloat(e.target.value) })}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-bg-tertiary accent-accent"
              disabled={disabled}
            />
            <div className="mt-1 flex justify-between text-[10px] text-text-tertiary">
              <span>0</span>
              <span>2</span>
            </div>
          </div>

          <div>
            <label htmlFor={ids.maxTokens} className={labelClass}>
              Max tokens
            </label>
            <Input
              id={ids.maxTokens}
              type="number"
              min={1}
              max={128000}
              value={value.maxTokens}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (!Number.isNaN(v) && v > 0) onChange({ maxTokens: v })
              }}
              disabled={disabled}
            />
          </div>
        </>
      )}

      <Input
        label="API key override"
        type="password"
        autoComplete="off"
        value={value.apiKey}
        onChange={(e) => onChange({ apiKey: e.target.value })}
        placeholder="Session key (default)"
        description="Optional. Leave empty to use your login session."
      />
    </div>
  )
}
