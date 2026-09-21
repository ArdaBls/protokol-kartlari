import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { LOG_LIST_LABEL } from './notificationTypes'
import type { LogGroup } from './notificationTypes'

const formatTime = (ts?: number) => (ts ? new Date(ts).toLocaleString('tr-TR') : '')

export function LogGroupCard({ group }: { group: LogGroup }) {
  const [isOpen, setIsOpen] = useState(false)
  const editorNames = group.editorCounts.map((e) => e.name)
  const preview = editorNames.slice(0, 3).join(', ') + (editorNames.length > 3 ? ` +${editorNames.length - 3}` : '')

  return (
    <div className="border-b border-separator last:border-b-0">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-default/50"
      >
        <ChevronDown size={16} className={`shrink-0 text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-medium">{group.target}</span>
            <span className="shrink-0 rounded-full bg-default px-2 py-0.5 text-[11px] text-muted">{LOG_LIST_LABEL[group.list]}</span>
          </div>
          <div className="truncate text-xs text-muted">
            {group.entries.length > 1 ? `${group.entries.length} değişiklik · ${preview}` : preview}
          </div>
        </div>
        <span className="shrink-0 text-xs text-muted">{formatTime(group.lastTimestamp)}</span>
      </button>

      {isOpen && (
        <div className="flex flex-col gap-3 bg-surface-secondary/30 px-4 py-3 pl-10">
          {group.editorCounts.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {group.editorCounts.map((editor) => (
                <span key={editor.name} className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent">
                  {editor.name} · {editor.count} kez
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2">
            {group.entries.map((entry, index) => (
              <div key={index} className="flex flex-col gap-0.5 rounded-xl border border-separator bg-surface px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{entry.by || entry.email || '?'}</span>
                  <span className="shrink-0 text-muted">{formatTime(entry.timestamp)}</span>
                </div>
                <span className="text-muted">{entry.action}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
