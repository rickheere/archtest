export function calculateBreakeven(position: any) {
  return position.entryPrice;
}

export function formatCurrency(amount: number) {
  return `$${amount.toFixed(2)}`;
}
