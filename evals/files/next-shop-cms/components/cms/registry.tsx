import DOMPurify from 'isomorphic-dompurify';
import type { CmsComponent } from '@/lib/cms';
import { mediaUrl } from '@/lib/occ';

export function componentKey(c: CmsComponent): string {
  if (c.typeCode === 'CMSFlexComponent' && c.flexType) return c.flexType;
  if (c.typeCode === 'JspIncludeComponent') return c.uid;
  return c.typeCode;
}

function Paragraph({ data }: { data: CmsComponent }) {
  return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(String(data.content ?? '')) }} />;
}

function Banner({ data }: { data: CmsComponent }) {
  const media = data.media as Record<string, { url?: string; altText?: string }> | undefined;
  const img = media?.desktop ?? media?.tablet ?? media?.mobile;
  return img?.url ? <img src={mediaUrl(img.url)} alt={img.altText ?? ''} /> : null;
}

export const registry: Record<string, (p: { data: CmsComponent }) => React.ReactNode> = {
  CMSParagraphComponent: Paragraph,
  SimpleResponsiveBannerComponent: Banner,
};
