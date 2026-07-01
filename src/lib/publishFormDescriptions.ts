/**
 * Card descriptions for publish forms — parallel wording aligned with DP-1 core
 * (playlist, playlist-group) and the channel extension (extends playlist-group).
 */

export const publishFormEditDescription =
  'Edit in the form or JSON tab, then sign to PATCH the feed document.'

/** Core playlist — ordered artwork items; curator signature role. */
export const playlistFormCreateDescription =
  'Core DP-1 playlist — ordered artwork items for distribution and verification. Sign with your connected wallet as curator.'

export const playlistFormCreateDescriptionCoreOnly =
  `${playlistFormCreateDescription} Extension fields are hidden when extensions are off for this deployment.`

/** Core playlist-group — ordered playlist URIs + shared metadata; curator role. */
export const playlistGroupFormCreateDescription =
  'Core DP-1 playlist group — curator-authored, ordered playlist URIs with shared metadata. Sign with your connected wallet as curator.'

/** Channel extension — extends playlist-group; publisher signature role. */
export const channelFormCreateDescription =
  'Channel extension — ordered playlist URIs with publisher and curator metadata. Sign with your connected wallet as publisher.'
