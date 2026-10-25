import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import {
  ALLO_CALL_COMPANY_FIELD_UNIVERSAL_IDENTIFIER,
  ALLO_CALL_OBJECT_UNIVERSAL_IDENTIFIER,
  COMPANY_ALLO_CALLS_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

// The "one" side: a company lists every Allo call with one of its people.
export default defineField({
  universalIdentifier: COMPANY_ALLO_CALLS_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
  type: FieldType.RELATION,
  name: 'alloCalls',
  label: 'Allo Calls',
  description: 'Allo calls with people at this company.',
  icon: 'IconPhone',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier:
    ALLO_CALL_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier:
    ALLO_CALL_COMPANY_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
