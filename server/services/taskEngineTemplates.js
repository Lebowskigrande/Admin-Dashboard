import { getSimpleStatusListTitle } from '../../shared/taskStatus.js';

export const getStatusTemplateDefinitions = ({
    templateIdPrefix,
    listKey,
    listTitle,
    dueOffsetDays,
    priorityBase
}) => [{
    id: `${templateIdPrefix}-${listKey}`,
    listKey,
    listTitle: listTitle || getSimpleStatusListTitle(listKey, 'Task'),
    listMode: 'sequential',
    stepKey: listKey,
    title: listTitle || getSimpleStatusListTitle(listKey, 'Task'),
    sortOrder: 10,
    dueOffsetDays,
    priorityBase
}];

export const WORSHIP_TEMPLATE_SCHEMAS = {
    'rite-i-service': [
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-ritei',
            listKey: 'bulletin',
            listTitle: 'Bulletin',
            dueOffsetDays: -5,
            priorityBase: 70
        }),
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-ritei',
            listKey: 'music',
            listTitle: 'Music',
            dueOffsetDays: -7,
            priorityBase: 62
        })
    ],
    'rite-ii-service': [
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-riteii',
            listKey: 'bulletin',
            listTitle: 'Bulletin',
            dueOffsetDays: -5,
            priorityBase: 70
        }),
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-riteii',
            listKey: 'insert',
            listTitle: 'Insert',
            dueOffsetDays: -4,
            priorityBase: 68
        }),
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-riteii',
            listKey: 'music',
            listTitle: 'Music',
            dueOffsetDays: -7,
            priorityBase: 62
        })
    ],
    'weekly-service': [
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-weekly',
            listKey: 'bulletin',
            listTitle: 'Bulletin',
            dueOffsetDays: -5,
            priorityBase: 70
        }),
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-weekly',
            listKey: 'insert',
            listTitle: 'Insert',
            dueOffsetDays: -4,
            priorityBase: 68
        }),
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-weekly',
            listKey: 'music',
            listTitle: 'Music',
            dueOffsetDays: -7,
            priorityBase: 62
        })
    ],
    'special-service': [
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-special',
            listKey: 'bulletin',
            listTitle: 'Bulletin',
            dueOffsetDays: -5,
            priorityBase: 70
        }),
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-special',
            listKey: 'clergy',
            listTitle: 'Clergy & Roles',
            dueOffsetDays: -7,
            priorityBase: 68
        }),
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-special',
            listKey: 'music',
            listTitle: 'Music',
            dueOffsetDays: -7,
            priorityBase: 66
        })
    ],
    'eucharist-service': []
};

export const syncDefaultWorshipServiceTemplates = ({
    getEventTypeIdsBySlugs,
    clearTemplates,
    upsertTemplate
}) => {
    const worshipTypeIds = getEventTypeIdsBySlugs(Object.keys(WORSHIP_TEMPLATE_SCHEMAS));
    if (!worshipTypeIds.length) return;

    clearTemplates(worshipTypeIds.map((row) => String(row.id)));
    worshipTypeIds.forEach(({ slug, id }) => {
        const definitions = WORSHIP_TEMPLATE_SCHEMAS[slug] || [];
        definitions.forEach((definition) => upsertTemplate({
            ...definition,
            id: `${definition.id}-${slug}`,
            originType: 'event',
            originId: String(id)
        }));
    });
};
