// Receipts are durable idempotency keys, not a recent-activity display cache.
export function copyReceipts(receipts) {
  return receipts && typeof receipts === 'object' ? { ...receipts } : {}
}
export function paymentDisposition(round, receipt) {
  if (receipt) return 'paid'
  // Earlier clients evicted receipts after 80 actions. A missing legacy receipt
  // cannot distinguish an unpaid award from an already paid/evicted award.
  return round?.surum === 2 ? 'pay' : 'review'
}
