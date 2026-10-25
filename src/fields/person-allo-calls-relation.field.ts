import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import {
  ALLO_CALL_OBJECT_UNIVERSAL_IDENTIFIER,
  ALLO_CALL_PERSON_FIELD_UNIVERSAL_IDENTIFIER,
  PERSON_ALLO_CALLS_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

// The "one" side: a person lists every Allo call they were part of.
export default defineField({
  universalIdentifier: PERSON_ALLO_CALLS_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.RELATION,
  name: 'alloCalls',
  label: 'Allo Calls',
  description: 'Allo calls with this person.',
  icon: 'IconPhone',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier:
    ALLO_CALL_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier:
    ALLO_CALL_PERSON_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
