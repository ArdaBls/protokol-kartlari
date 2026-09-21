import { Card } from '@heroui/react'

interface PlaceholderPageProps {
  title: string
}

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="mb-6 text-2xl font-semibold">{title}</h1>
      <Card>
        <Card.Header>
          <Card.Title>Henüz taşınmadı</Card.Title>
          <Card.Description>Bu sayfa HeroUI sürümüne sırayla aktarılacak.</Card.Description>
        </Card.Header>
      </Card>
    </div>
  )
}
