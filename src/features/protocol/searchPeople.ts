import Fuse from 'fuse.js'
import type { Person } from './protocolRules'
import { searchText } from './protocolRules'

const FUZZY_THRESHOLD = 0.35

/**
 * Türkçe duyarlı arama: birebir (alt metin) eşleşme varsa yalnızca onlar döner; hiç yoksa
 * yazım hatalarını tolere eden bulanık sonuçlar kullanılır.
 */
export function createPeopleSearch(people: Person[]) {
  const fuse = new Fuse(
    people.map((person) => ({ person, text: searchText(person) })),
    { keys: ['text'], threshold: FUZZY_THRESHOLD, ignoreLocation: true },
  )

  return (query: string): Person[] => {
    const normalized = query.trim().toLocaleLowerCase('tr')
    if (!normalized) return people
    const exact = people.filter((person) => searchText(person).includes(normalized))
    return exact.length ? exact : fuse.search(normalized).map((result) => result.item.person)
  }
}
