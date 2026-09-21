import { Card } from '@heroui/react'
import { Link } from 'react-router-dom'
import { GameCover } from './GameCover'
import { GAMES } from './gamesList'

export function GamesPage() {
  return (
    <div className="mx-auto flex max-w-[1300px] flex-col gap-5">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">Uygulamalar</div>
        <h1 className="mt-1 text-2xl font-semibold">Oyunlar</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {GAMES.map((game) => {
          const content = (
            <Card className="overflow-hidden p-0 transition-transform group-hover:-translate-y-0.5">
              <GameCover gameKey={game.key} />
              <Card.Content className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{game.title}</span>
                  {!game.implemented && (
                    <span className="rounded-full bg-default px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">Yakında</span>
                  )}
                </div>
                <p className="text-xs text-muted">{game.description}</p>
              </Card.Content>
            </Card>
          )
          return game.implemented ? (
            <Link key={game.key} to={game.path} className="group">
              {content}
            </Link>
          ) : (
            <div key={game.key} className="group cursor-not-allowed opacity-70">
              {content}
            </div>
          )
        })}
      </div>
    </div>
  )
}
