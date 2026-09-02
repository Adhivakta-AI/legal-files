export function sourceToken(id: string): string {
  return id.length > 13 ? `${id.slice(0, 7)}…${id.slice(-4)}` : id
}
