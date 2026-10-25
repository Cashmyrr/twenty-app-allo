import { defineView, ViewSortDirection } from 'twenty-sdk/define';

import {
  ALLO_CALL_DIRECTION_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALL_DURATION_LABEL_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALL_MEMBER_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALL_NAME_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALL_OBJECT_UNIVERSAL_IDENTIFIER,
  ALLO_CALL_PERSON_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALL_RESULT_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALL_STARTED_AT_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALL_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALL_SUMMARY_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALLS_VIEW_DIRECTION_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALLS_VIEW_DURATION_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALLS_VIEW_MEMBER_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALLS_VIEW_NAME_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALLS_VIEW_PERSON_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALLS_VIEW_RESULT_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALLS_VIEW_STARTED_AT_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALLS_VIEW_STARTED_AT_SORT_UNIVERSAL_IDENTIFIER,
  ALLO_CALLS_VIEW_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALLS_VIEW_SUMMARY_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALLS_VIEW_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineView({
  universalIdentifier: ALLO_CALLS_VIEW_UNIVERSAL_IDENTIFIER,
  name: 'All calls',
  objectUniversalIdentifier: ALLO_CALL_OBJECT_UNIVERSAL_IDENTIFIER,
  icon: 'IconPhone',
  position: 0,
  fields: [
    {
      universalIdentifier: ALLO_CALLS_VIEW_NAME_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier:
        ALLO_CALL_NAME_FIELD_UNIVERSAL_IDENTIFIER,
      position: 0,
      isVisible: true,
      size: 260,
    },
    {
      universalIdentifier:
        ALLO_CALLS_VIEW_STARTED_AT_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier:
        ALLO_CALL_STARTED_AT_FIELD_UNIVERSAL_IDENTIFIER,
      position: 1,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: ALLO_CALLS_VIEW_DIRECTION_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier:
        ALLO_CALL_DIRECTION_FIELD_UNIVERSAL_IDENTIFIER,
      position: 2,
      isVisible: true,
      size: 110,
    },
    {
      universalIdentifier: ALLO_CALLS_VIEW_MEMBER_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier:
        ALLO_CALL_MEMBER_FIELD_UNIVERSAL_IDENTIFIER,
      position: 3,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: ALLO_CALLS_VIEW_PERSON_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier:
        ALLO_CALL_PERSON_FIELD_UNIVERSAL_IDENTIFIER,
      position: 4,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: ALLO_CALLS_VIEW_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier:
        ALLO_CALL_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
      position: 5,
      isVisible: true,
      size: 120,
    },
    {
      universalIdentifier: ALLO_CALLS_VIEW_RESULT_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier:
        ALLO_CALL_RESULT_FIELD_UNIVERSAL_IDENTIFIER,
      position: 6,
      isVisible: true,
      size: 130,
    },
    {
      universalIdentifier: ALLO_CALLS_VIEW_DURATION_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier:
        ALLO_CALL_DURATION_LABEL_FIELD_UNIVERSAL_IDENTIFIER,
      position: 7,
      isVisible: true,
      size: 100,
    },
    {
      universalIdentifier: ALLO_CALLS_VIEW_SUMMARY_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier:
        ALLO_CALL_SUMMARY_FIELD_UNIVERSAL_IDENTIFIER,
      position: 8,
      isVisible: true,
      size: 360,
    },
  ],
  sorts: [
    {
      universalIdentifier: ALLO_CALLS_VIEW_STARTED_AT_SORT_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier:
        ALLO_CALL_STARTED_AT_FIELD_UNIVERSAL_IDENTIFIER,
      direction: ViewSortDirection.DESC,
    },
  ],
});
