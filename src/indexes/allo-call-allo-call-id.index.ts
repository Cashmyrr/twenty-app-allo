import { defineIndex, IndexType } from 'twenty-sdk/define';

import {
  ALLO_CALL_ALLO_CALL_ID_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALL_ID_INDEX_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALL_ID_INDEX_UNIVERSAL_IDENTIFIER,
  ALLO_CALL_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

// call.completed looks the record up by Allo's call ID.
export default defineIndex({
  universalIdentifier: ALLO_CALL_ID_INDEX_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: ALLO_CALL_OBJECT_UNIVERSAL_IDENTIFIER,
  indexType: IndexType.BTREE,
  fields: [
    {
      universalIdentifier: ALLO_CALL_ID_INDEX_FIELD_UNIVERSAL_IDENTIFIER,
      fieldUniversalIdentifier:
        ALLO_CALL_ALLO_CALL_ID_FIELD_UNIVERSAL_IDENTIFIER,
    },
  ],
});
