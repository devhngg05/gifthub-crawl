export interface RelativeTimeProps {
  isoDate: string;
}

export function RelativeTime({ isoDate }: RelativeTimeProps) {
  return <time dateTime={isoDate}>{isoDate.slice(0, 10)}</time>;
}
