// Browser bundle of the shared audiobook highlight engine (@noble-collective/userdata/narration —
// the mobile app's NarrationAlignment, ported; Collective-Shared ARCHITECTURE §9b) as
// window.NCNarration, for the plain-script audio-player.js. Rebuild with `npm run build:narration`.
import * as narration from '@noble-collective/userdata/narration'

window.NCNarration = narration
