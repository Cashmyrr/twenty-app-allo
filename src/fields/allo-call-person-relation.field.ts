import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import {
  ALLO_CALL_OBJECT_UNIVERSAL_IDENTIFIER,
  ALLO_CALL_PERSON_FIELD_UNIVERSAL_IDENTIFIER,
  PERSON_ALLO_CALLS_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

// The "many" side: each call points to the person on the other end, resolved
// from the Allo contact's email, then from the contact phone number.
export default defineField({
  universalIdentifier: ALLO_CALL_PERSON_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: ALLO_CALL_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'person',
  label: 'Person',
  description: 'The person on the other end of this call.',
  icon: 'IconUser',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier:
    PERSON_ALLO_CALLS_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'personId',
  },
});
