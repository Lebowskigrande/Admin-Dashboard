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

export const EVENT_TEMPLATE_SCHEMAS = {
    ...WORSHIP_TEMPLATE_SCHEMAS,
    'funeral': [
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-funeral',
            listKey: 'bulletin',
            listTitle: 'Bulletin',
            dueOffsetDays: -5,
            priorityBase: 72
        }),
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-funeral',
            listKey: 'clergy',
            listTitle: 'Clergy',
            dueOffsetDays: -7,
            priorityBase: 70
        }),
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-funeral',
            listKey: 'music',
            listTitle: 'Music',
            dueOffsetDays: -7,
            priorityBase: 68
        })
    ],
    'wedding': [
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-wedding',
            listKey: 'documents',
            listTitle: 'Documents',
            dueOffsetDays: -10,
            priorityBase: 72
        }),
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-wedding',
            listKey: 'music',
            listTitle: 'Music',
            dueOffsetDays: -10,
            priorityBase: 68
        })
    ],
    'concert': [
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-concert',
            listKey: 'music',
            listTitle: 'Music',
            dueOffsetDays: -10,
            priorityBase: 70
        }),
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-concert',
            listKey: 'communications',
            listTitle: 'Comms',
            dueOffsetDays: -7,
            priorityBase: 66
        })
    ],
    'meeting': [],
    'rehearsal': [],
    'class-formation': [],
    'volunteer': [],
    'private-rental': [
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-rental',
            listKey: 'contracts',
            listTitle: 'Contracts',
            dueOffsetDays: -10,
            priorityBase: 68
        })
    ],
    'maintenance-closure': [
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-maintenance',
            listKey: 'communications',
            listTitle: 'Comms',
            dueOffsetDays: -1,
            priorityBase: 54
        })
    ]
};

export const syncDefaultEventTemplates = ({
    getEventTypeIdsBySlugs,
    clearTemplates,
    upsertTemplate
}) => {
    const eventTypeIds = getEventTypeIdsBySlugs(Object.keys(EVENT_TEMPLATE_SCHEMAS));
    if (!eventTypeIds.length) return;

    clearTemplates(eventTypeIds.map((row) => String(row.id)));
    eventTypeIds.forEach(({ slug, id }) => {
        const definitions = EVENT_TEMPLATE_SCHEMAS[slug] || [];
        definitions.forEach((definition) => upsertTemplate({
            ...definition,
            id: `${definition.id}-${slug}`,
            originType: 'event',
            originId: String(id)
        }));
    });
};

export const syncDefaultWorshipServiceTemplates = (args) => syncDefaultEventTemplates(args);
