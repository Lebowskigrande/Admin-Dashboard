export const MAP_AREAS = [
    {
        id: 'sanctuary',
        name: 'Church',
        type: 'building',
        category: 'Worship',
        description: 'Main worship space, nave, and sacristy access.',
        shape: 'poly',
        points: [
            [277, 554], [356, 536], [435, 557], [436, 591], [469, 591],
            [468, 698], [431, 699], [428, 962], [355, 969], [273, 957],
            [276, 697], [240, 694], [241, 593], [276, 592]
        ]
    },
    {
        id: 'parish-hall',
        name: 'Fellows Hall',
        type: 'building',
        category: 'All Purpose',
        description: 'Fellowship hall, kitchens, and meeting rooms.',
        shape: 'rect',
        rect: { x: 15, y: 1397, width: 226, height: 104 }
    },
    {
        id: 'office',
        name: 'Office/School',
        type: 'building',
        category: 'All Purpose',
        description: 'Administration, classrooms, and staff workspace.',
        shape: 'poly',
        points: [
            [20, 1025], [121, 1027], [121, 1079], [145, 1080], [144, 1122],
            [118, 1123], [116, 1242], [151, 1244], [150, 1345], [204, 1343],
            [241, 1396], [12, 1401]
        ]
    },
    {
        id: 'chapel',
        name: 'Chapel',
        type: 'building',
        category: 'Worship',
        description: 'Weekday services and quiet prayer.',
        shape: 'rect',
        rect: { x: 253, y: 1259, width: 241, height: 92 }
    },
    {
        id: 'parking-north',
        name: 'North Parking',
        type: 'parking',
        description: 'Primary lot with 48 spaces and ADA access.',
        shape: 'rect',
        rect: { x: 261, y: 14, width: 228, height: 530 }
    },
    {
        id: 'parking-south',
        name: 'South Parking',
        type: 'parking',
        description: 'Overflow lot and service access.',
        shape: 'rect',
        rect: { x: 247, y: 1353, width: 276, height: 148 }
    },
    {
        id: 'playground',
        name: 'Playground',
        type: 'grounds',
        description: 'Outdoor play area and family gathering space.',
        shape: 'rect',
        rect: { x: 11, y: 474, width: 226, height: 532 }
    },
    {
        id: 'close',
        name: 'Close',
        type: 'grounds',
        description: 'Green space, garden beds, and footpaths.',
        shape: 'rect',
        rect: { x: 238, y: 1040, width: 230, height: 170 }
    },
    {
        id: 'main-gate',
        name: 'Main Gate',
        type: 'entry',
        description: 'Main pedestrian entry off the street.',
        shape: 'rect',
        rect: { x: 494, y: 1098, width: 36, height: 30 }
    },
    {
        id: 'south-parking-gate',
        name: 'South Parking Gate',
        type: 'entry',
        description: 'Gate access to the south parking lot.',
        shape: 'poly',
        points: [
            [213, 1352], [241, 1335], [255, 1356], [227, 1373]
        ]
    },
    {
        id: 'north-parking-gate',
        name: 'North Parking Gate',
        type: 'entry',
        description: 'Gate access to the north parking lot.',
        shape: 'rect',
        rect: { x: 225, y: 498, width: 23, height: 55 }
    }
];
