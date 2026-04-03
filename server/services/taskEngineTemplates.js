export const STATUS_PROGRESS_STEPS = [
    { key: 'in-process', title: 'In Process', sort_order: 10 },
    { key: 'done', title: 'Done', sort_order: 20 }
];

export const getStatusTemplateDefinitions = ({
    templateIdPrefix,
    listKey,
    listTitle,
    dueOffsetDays,
    priorityBase
}) => STATUS_PROGRESS_STEPS.map((step, index) => ({
    id: `${templateIdPrefix}-${listKey}-${step.key}`,
    listKey,
    listTitle,
    listMode: 'progressive',
    stepKey: `${listKey}-${step.key}`,
    title: step.title,
    sortOrder: step.sort_order,
    dueOffsetDays: index === 0 ? dueOffsetDays : -1,
    priorityBase
}));

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
