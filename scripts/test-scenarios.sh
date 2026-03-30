#!/bin/bash
USER="c5dd5b0f-2fd9-48c1-b17a-933f6c926d7a"
BASE="http://localhost:3000/api/test-conversation"

run_test() {
  local label="$1"
  local msg="$2"
  echo "==============================="
  echo "$label"
  echo "==============================="
  curl -s -X POST "$BASE" \
    -H "Content-Type: application/json" \
    -d "{\"userId\":\"$USER\",\"message\":\"$msg\",\"skipTts\":true}" \
    | python3 -m json.tool
  echo ""
}

run_test "S1: RELATIONSHIP / MARRIAGE" \
  "My wife says I never open up. Every time she tries to talk I just shut down. We had another big fight last night. I dont even know if I love her anymore or if Im just scared to be alone."

run_test "S2: CAREER STAGNATION" \
  "Ive been at this company 6 years. Same title. I keep saying Ill apply elsewhere but I never do. My coworker who started after me just got promoted. Im so angry but I dont know who to be angry at."

run_test "S3: GRIEF" \
  "My dad died three months ago. People keep saying I should be over it by now. I havent cried once. I feel nothing. Is something wrong with me?"

run_test "S4: IDENTITY CRISIS" \
  "I built my whole identity around being a provider. Now Im 45 and my kids dont need me the same way, my wife has her own career, and I genuinely dont know who I am anymore without that role."

run_test "S5: FATHER WOUND" \
  "My father was never there. He was physically present but completely checked out. I swore Id be different with my own kids but I catch myself doing the exact same thing, sitting in the room but not really there. Im becoming him."

