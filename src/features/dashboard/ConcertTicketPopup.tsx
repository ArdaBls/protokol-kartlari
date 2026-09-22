import { Button } from '@heroui/react'
import { Ticket } from 'lucide-react'
import type { CalendarEvent } from '../../lib/eventOverview'
import './concertTicket.css'

interface ConcertTicketPopupProps {
  event: CalendarEvent
  userName: string
  isOpen: boolean
  onClose: () => void
}

interface ConcertTicketButtonProps {
  onPress: () => void
}

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

function formatTicketDate(event: CalendarEvent) {
  const [year, month, day] = String(event.tarih ?? '').split('-').map(Number)
  if (![year, month, day].every(Number.isFinite) || month < 1 || month > 12) return event.tarih ?? ''
  return `${day} ${MONTHS[month - 1]} ${year}${event.saat ? ` · ${event.saat}` : ''}`
}

export function ConcertTicketButton({ onPress }: ConcertTicketButtonProps) {
  return (
    <Button
      isIconOnly
      size="sm"
      variant="secondary"
      aria-label="Bugünün konser biletini aç"
      className="concert-ticket-chip size-8 min-w-8"
      onPress={onPress}
    >
      <Ticket size={16} />
    </Button>
  )
}

export function ConcertTicketPopup({ event, userName, isOpen, onClose }: ConcertTicketPopupProps) {
  if (!isOpen) return null

  return (
    <div
      className="concert-ticket-overlay"
      role="dialog"
      aria-label="Konser bileti"
      onClick={onClose}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <div className="concert-ticket-overlay-inner">
        <div className="concert-ticket-card" aria-label={`${event.ad || 'Konser'} bileti`}>
          <div className="notes">♪♪♪♪♪</div>
          <div className="notes">♪♪♪♪</div>
          <div className="notes">♪♪♪♪♪</div>
          <div className="header">
            TICKET
            <div className="symbol">✁</div>
          </div>
          <div className="body">
            <em>{event.ad || 'Konser Adı'}</em>
            <br />
            <span>{formatTicketDate(event)}</span>
            <br />
            <span>{event.yer || 'Etkinlik alanı'}</span>
          </div>
          <div className="footer">
            <div className="number"><span className="bold">{userName || 'Misafir'}</span></div>
            <div className="barcode" aria-hidden="true" />
          </div>
          <div className="bg holographic" />
          <svg className="filter" aria-hidden="true">
            <filter id="bump">
              <feTurbulence result="noise" numOctaves="3" baseFrequency="0.7" type="fractalNoise" />
              <feSpecularLighting in="noise" result="specular" lightingColor="#fffffc" specularExponent="25" specularConstant="0.8" surfaceScale="0.15">
                <fePointLight z="210" y="100" x="100" />
              </feSpecularLighting>
              <feComposite result="noise2" operator="in" in="specular" in2="SourceGraphic" />
              <feBlend mode="screen" in2="noise2" in="SourceGraphic" />
            </filter>
          </svg>
        </div>
      </div>
    </div>
  )
}
