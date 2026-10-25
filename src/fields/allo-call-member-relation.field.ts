import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import {
  ALLO_CALL_MEMBER_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALL_OBJECT_UNIVERSAL_IDENTIFIER,
  WORKSPACE_MEMBER_ALLO_CALLS_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

// The "many" side: each call points to the workspace member who handled it,
// resolved from the Allo payload's `user_email`.
export default defineField({
  universalIdentifier: ALLO_CALL_MEMBER_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: ALLO_CALL_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'member',
  label: 'Member',
  description: 'The Twenty member who made or answered this call.',
  icon: 'IconUserCircle',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.workspaceMember.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier:
    WORKSPACE_MEMBER_ALLO_CALLS_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'memberId',
  },
});
