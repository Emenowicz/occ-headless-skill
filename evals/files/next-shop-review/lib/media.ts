export function mediaUrl(url: string) {
  const path = url.split('?')[0];
  return `${process.env.NEXT_PUBLIC_MEDIA_HOST}${path}`;
}
