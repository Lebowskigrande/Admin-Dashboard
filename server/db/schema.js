import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const liturgicalDays = sqliteTable('liturgical_days', {
    date: text('date').primaryKey(),
    feast: text('feast'),
    color: text('color'),
    readings: text('readings')
});

export const users = sqliteTable('users', {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    createdAt: text('created_at').notNull()
});

export const userTokens = sqliteTable('user_tokens', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    expiryDate: integer('expiry_date'),
    scope: text('scope'),
    tokenType: text('token_type'),
    createdAt: text('created_at').notNull()
});

export const userSessions = sqliteTable('user_sessions', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull()
});

export const calendars = sqliteTable('calendars', {
    id: text('id').primaryKey(),
    summary: text('summary').notNull(),
    backgroundColor: text('background_color'),
    timeZone: text('time_zone')
});

export const calendarLinks = sqliteTable('calendar_links', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    calendarId: text('calendar_id').notNull(),
    selected: integer('selected').notNull().default(0)
});

export const people = sqliteTable('people', {
    id: text('id').primaryKey(),
    displayName: text('display_name').notNull(),
    email: text('email'),
    phonePrimary: text('phone_primary'),
    phoneAlternate: text('phone_alternate'),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    category: text('category'),
    roles: text('roles'),
    tags: text('tags'),
    teams: text('teams')
});

export const buildings = sqliteTable('buildings', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    category: text('category'),
    capacity: integer('capacity').default(0),
    sizeSqft: integer('size_sqft').default(0),
    rentalRateHour: real('rental_rate_hour').default(0),
    rentalRateDay: real('rental_rate_day').default(0),
    parkingSpaces: integer('parking_spaces').default(0),
    eventTypes: text('event_types'),
    notes: text('notes')
});

export const rooms = sqliteTable('rooms', {
    id: text('id').primaryKey(),
    buildingId: text('building_id').notNull(),
    name: text('name').notNull(),
    floor: integer('floor'),
    capacity: integer('capacity'),
    rentalRate: real('rental_rate'),
    notes: text('notes')
});

export const preferredVendors = sqliteTable('preferred_vendors', {
    id: text('id').primaryKey(),
    service: text('service'),
    vendor: text('vendor').notNull(),
    contact: text('contact'),
    phone: text('phone'),
    email: text('email'),
    notes: text('notes'),
    contract: text('contract')
});

export const eventCategories = sqliteTable('event_categories', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    color: text('color').notNull(),
    description: text('description'),
    icon: text('icon')
});

export const eventTypes = sqliteTable('event_types', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    categoryId: integer('category_id'),
    color: text('color'),
    requiresContract: integer('requires_contract').default(0),
    requiresStaffing: integer('requires_staffing').default(0),
    requiresSetup: integer('requires_setup').default(0),
    isPublic: integer('is_public').default(1)
});

export const events = sqliteTable('events', {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    eventTypeId: integer('event_type_id'),
    source: text('source').default('manual'),
    metadata: text('metadata'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
});

export const eventOccurrences = sqliteTable('event_occurrences', {
    id: text('id').primaryKey(),
    eventId: text('event_id').notNull(),
    date: text('date').notNull(),
    startTime: text('start_time'),
    endTime: text('end_time'),
    buildingId: text('building_id'),
    rite: text('rite'),
    isDefault: integer('is_default').default(0),
    notes: text('notes')
});

export const assignments = sqliteTable('assignments', {
    id: text('id').primaryKey(),
    occurrenceId: text('occurrence_id').notNull(),
    roleKey: text('role_key').notNull(),
    personId: text('person_id').notNull()
});

export const tasksNew = sqliteTable('tasks_new', {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('active'),
    priorityBase: integer('priority_base').notNull().default(50),
    taskType: text('task_type'),
    dueMode: text('due_mode').notNull().default('floating'),
    defaultDurationMin: integer('default_duration_min'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
});

export const taskInstances = sqliteTable('task_instances', {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    state: text('state').notNull().default('open'),
    dueAt: text('due_at'),
    startAt: text('start_at'),
    completedAt: text('completed_at'),
    generatedFrom: text('generated_from'),
    generationKey: text('generation_key'),
    priorityOverride: integer('priority_override'),
    rank: integer('rank'),
    slaTargetAt: text('sla_target_at'),
    blocked: integer('blocked').notNull().default(0)
});

export const entityLinks = sqliteTable('entity_links', {
    id: text('id').primaryKey(),
    fromType: text('from_type').notNull(),
    fromId: text('from_id').notNull(),
    toType: text('to_type').notNull(),
    toId: text('to_id').notNull(),
    role: text('role'),
    createdAt: text('created_at').notNull(),
    metaJson: text('meta_json')
});

export const taskPriorityPolicy = sqliteTable('task_priority_policy', {
    id: text('id').primaryKey(),
    taskType: text('task_type').unique(),
    defaultPriorityBase: integer('default_priority_base'),
    overdueBoost: integer('overdue_boost'),
    dueTodayBoost: integer('due_today_boost'),
    dueSoonBoost: integer('due_soon_boost'),
    noDueBoost: integer('no_due_boost')
});
