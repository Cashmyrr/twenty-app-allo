import { defineIndex, IndexType } from 'twenty-sdk/define';

import {
  ALLO_CALL_CORRELATION_KEY_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALL_CORRELATION_KEY_INDEX_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALL_CORRELATION_KEY_INDEX_UNIVERSAL_IDENTIFIER,
  ALLO_CALL_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

// Every event before call.completed looks the record up by correlation key.
// Deliberately not unique: a duplicate is a cosmetic annoyance, whereas a
// unique violation would fail the webhook and make Allo retry forever.
export default defineIndex({
  universalIdentifier: ALLO_CALL_CORRELATION_KEY_INDEX_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: ALLO_CALL_OBJECT_UNIVERSAL_IDENTIFIER,
  indexType: IndexType.BTREE,
  fields: [
    {
      universalIdentifier:
        ALLO_CALL_CORRELATION_KEY_INDEX_FIELD_UNIVERSAL_IDENTIFIER,
      fieldUniversalIdentifier:
        ALLO_CALL_CORRELATION_KEY_FIELD_UNIVERSAL_IDENTIFIER,
    },
  ],
});
