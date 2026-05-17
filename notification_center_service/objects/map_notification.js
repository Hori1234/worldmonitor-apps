/**
 * objects/map_notification.js
 * Factory + validator for Map Data (geo-event) notifications.
 */

const VALID_CATEGORIES = ['aircraft', 'vessel', 'news', 'weather', 'other'];
const VALID_ENTITY_TYPES = ['aircraft', 'vessel', 'person', 'organisation', 'other'];

export function createMapNotification(data) {
  if (!data.eventCategory) throw new Error('Map notification missing required field: eventCategory');
  return {
    id:            crypto.randomUUID(),
    kind:          'map',
    type:          data.type          ?? 'info',
    title:         data.title         ?? `Map event: ${data.eventCategory}`,
    body:          data.body          ?? '',
    source:        data.source        ?? 'external',
    read:          false,
    timestamp:     new Date().toISOString(),
    // map-specific
    eventCategory: VALID_CATEGORIES.includes(data.eventCategory) ? data.eventCategory : 'other',
    subCategory:   data.subCategory   ?? '',
    coordinates: {
      lat:      data.coordinates?.lat      ?? 0,
      lng:      data.coordinates?.lng      ?? 0,
      altitude: data.coordinates?.altitude ?? null,
      heading:  data.coordinates?.heading  ?? null,
      speed:    data.coordinates?.speed    ?? null,
    },
    boundingBox: data.boundingBox ? {
      northEast: { lat: data.boundingBox.northEast?.lat ?? 0, lng: data.boundingBox.northEast?.lng ?? 0 },
      southWest: { lat: data.boundingBox.southWest?.lat ?? 0, lng: data.boundingBox.southWest?.lng ?? 0 },
    } : null,
    country:     data.country     ?? '',
    countryCode: data.countryCode ?? '',
    region:      data.region      ?? '',
    entityId:    data.entityId    ?? '',
    entityName:  data.entityName  ?? '',
    entityType:  VALID_ENTITY_TYPES.includes(data.entityType) ? data.entityType : 'other',
    tags:        Array.isArray(data.tags) ? data.tags : [],
    meta:        data.meta        ?? {},
  };
}

export function toICM(notification) {
  return {
    icmType:        'icm:map-event',
    notificationId: notification.id,
    eventCategory:  notification.eventCategory,
    country:        notification.country,
    countryCode:    notification.countryCode,
    entityName:     notification.entityName,
    coordinates:    { lat: notification.coordinates.lat, lng: notification.coordinates.lng },
    timestamp:      notification.timestamp,
  };
}
