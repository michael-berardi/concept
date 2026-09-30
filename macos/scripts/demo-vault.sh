#!/bin/bash
# Creates a small demo vault (Concept file format) for visual checks.
# Usage: demo-vault.sh <target-dir>
set -euo pipefail
DIR="${1:?usage: demo-vault.sh <target-dir>}"
mkdir -p "$DIR/.concept/databases" "$DIR/Pages" "$DIR/Data/deals" "$DIR/Data/contacts" "$DIR/Attachments"

echo '{"name":"Studio Demo","id":"demo-vault-0001","accent":"#5e8bff"}' > "$DIR/.concept/workspace.json"
printf '.retex/\n.trash/\n.DS_Store\n' > "$DIR/.gitignore"

cat > "$DIR/.concept/databases/deals.json" <<'EOF'
{
  "slug" : "deals",
  "name" : "Deals",
  "icon" : "◆",
  "recordType" : "deal",
  "properties" : [
    {"key":"title","name":"Name","type":"title"},
    {"key":"status","name":"Stage","type":"status","options":[
      {"id":"Inbox","color":"gray"},{"id":"Qualified","color":"blue"},
      {"id":"Proposal","color":"orange"},{"id":"Negotiation","color":"purple"},
      {"id":"Won","color":"green"},{"id":"Lost","color":"red"}]},
    {"key":"rank","name":"Rank","type":"text"},
    {"key":"owner","name":"Owner","type":"person"},
    {"key":"company","name":"Company","type":"relation","database":"companies"},
    {"key":"value","name":"Value","type":"number","format":"currency"},
    {"key":"due","name":"Due","type":"date"},
    {"key":"next_action","name":"Next action","type":"text"},
    {"key":"tags","name":"Labels","type":"multi_select"},
    {"key":"archived","name":"Archived","type":"checkbox"}
  ],
  "views" : [
    {"id":"board","name":"Pipeline","type":"board","groupBy":"status","filters":[],"sorts":[],"visible":["value","due"]},
    {"id":"table","name":"Table","type":"table","filters":[],"sorts":[{"key":"due","dir":"asc"}]}
  ]
}
EOF

write_deal() {
  local file="$1" title="$2" status="$3" rank="$4" owner="$5" value="$6" due="$7" tags="$8"
  cat > "$DIR/Data/deals/$file" <<EOF
---
title: $title
type: deal
status: $status
rank: $rank
owner: $owner
company: "[[Acme Industries]]"
value: $value
due: $due
tags: [$tags]
archived: false
---

# $title

Call [[Acme Industries]] about the rollout. See [[Platform Roadmap]].

- [ ] send updated SOW
- [x] intro call done
- [ ] schedule security review

Follow-ups land in [[Meetings]].
EOF
}

write_deal "acme-renewal.md"   "Acme renewal"        "Inbox"      "a0"  "mike" 24000 "2026-11-02" "priority"
write_deal "nordic-pilot.md"   "Nordic pilot"        "Qualified"  "a0"  "sam"  8500  "2026-10-21" "security"
write_deal "harbor-rollout.md" "Harbor rollout"      "Qualified"  "a0V" "mike" 15200 "2026-11-14" "priority"
write_deal "vertex-rrm.md"     "Vertex platform RFP" "Proposal"   "a0"  "ana"  46000 "2026-10-30" "rfp"
write_deal "lumen-studio.md"   "Lumen studio suite"  "Negotiation" "a0" "sam"  31000 "2026-12-05" "focus"
write_deal "atlas-web.md"      "Atlas web refresh"   "Won"        "a0"  "ana"  19800 "2026-10-05" "signed"

cat > "$DIR/Data/contacts/sam-ortega.md" <<'EOF'
---
title: Sam Ortega
type: contact
status: Active
email: sam@example.com
phone: "+1 555 0100"
company: "[[Acme Industries]]"
archived: false
---

# Sam Ortega

Primary contact at [[Acme Industries]].
EOF

cat > "$DIR/Pages/Platform Roadmap.md" <<'EOF'
---
title: Platform Roadmap
type: page
tags: [planning]
---

# Platform Roadmap

The vault is the truth: every file here is plain Markdown, readable by retex, Obsidian and git.

## Q4

- [ ] graph view performance pass
- [x] fractional rank math
- [ ] attachments sync

Linked deals: [[Vertex platform RFP]] and [[Harbor rollout]].

## Q1 next year

1. offline merge banner
2. template gallery
EOF

cat > "$DIR/Pages/Meetings.md" <<'EOF'
---
title: Meetings
type: page
---

# Meetings

Standup notes live here. Related: [[Platform Roadmap]].

> Decisions are only real when they are written down.

`rank` keys order cards inside a column — see [[Rank notes]].
EOF

cat > "$DIR/Pages/Rank notes.md" <<'EOF'
---
title: Rank notes
type: page
---

# Rank notes

Fractional ordering keys are short strings that sort lexicographically.
EOF

echo "demo vault at $DIR"
