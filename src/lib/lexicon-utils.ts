import type { Main as LinearDocument } from '../lexicons/pub/leaflet/pages/linearDocument.defs'

/**
 * Extracts plain text from a pub.leaflet.pages.linearDocument for use in
 * scoring and HuggingFace classification. Walks the block list and pulls
 * `plaintext` from all text-bearing block types (text, header, blockquote,
 * code). Non-text blocks (image, iframe, horizontalRule, etc.) are skipped.
 * List items are recursed into via their `content` blocks.
 */
export function extractDescriptionText(doc: LinearDocument | undefined): string {
  if (!doc) return ''

  const parts: string[] = []

  for (const wrapper of doc.blocks) {
    collectBlockText(wrapper.block, parts)
  }

  return parts.join('\n')
}

function collectBlockText(
  block: { $type?: string; [key: string]: unknown } | undefined,
  out: string[],
): void {
  if (!block || typeof block !== 'object') return

  const type = block.$type

  // All text-bearing leaf blocks share the `plaintext` field
  if (
    type === 'pub.leaflet.blocks.text' ||
    type === 'pub.leaflet.blocks.header' ||
    type === 'pub.leaflet.blocks.blockquote' ||
    type === 'pub.leaflet.blocks.code'
  ) {
    const pt = block.plaintext
    if (typeof pt === 'string' && pt.length > 0) {
      out.push(pt)
    }
    return
  }

  // Unordered list: recurse into children → each child has a `content` block
  if (type === 'pub.leaflet.blocks.unorderedList') {
    const children = block.children
    if (Array.isArray(children)) {
      for (const child of children) {
        if (child && typeof child === 'object') {
          // Each list item has a `content` which is a typed union of block types
          collectBlockText(
            (child as { content?: unknown }).content as { $type?: string; [key: string]: unknown },
            out,
          )
        }
      }
    }
    return
  }

  // All other block types (image, iframe, horizontalRule, bskyPost, math,
  // website, page, poll, button) carry no extractable plain text — skip.
}
