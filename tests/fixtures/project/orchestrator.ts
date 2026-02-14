import { Position } from './types';
import { calculateBreakeven } from './utils';

export function processPosition(position: Position) {
  const breakeven = calculateBreakeven(position);
  if (position.state === 'ENTRY_1') {
    // This violates the rule
    return handleEntry(position);
  }
  return position;
}

export function checkTP(position: Position) {
  const tpPrice = position.takeProfit;
  return tpPrice > 0;
}
