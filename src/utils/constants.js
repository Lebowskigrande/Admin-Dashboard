import { ROLE_DEFINITIONS } from '../models/roles';

export const ROLE_OPTIONS = ROLE_DEFINITIONS.map((role) => ({
    value: role.key,
    label: role.label
}));

export const HGK_DEFAULT_ITEMS = [
    'Bread',
    'Peanut Butter',
    'Jelly',
    'Chips (box)',
    'Granola Bars (box)',
    'Oranges',
    'Rice Krispie Treats (box)',
    'Water',
    'Lunch Bags',
    'Sandwich Bags',
    'Gloves',
    'Napkins'
];

export const HGK_STATUS_OPTIONS = ['needed', 'ordered', 'received'];
