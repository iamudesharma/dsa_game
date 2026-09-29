/// The eight curated topic worlds of the adventure map.
///
/// Generated titles, stories and object labels still come from the provider
/// chain, but the *visual* presentation is constrained to this table: a world
/// colour is an accent for scenery and stamps, never a replacement for the
/// semantic colours (success/danger/primary) or interaction conventions.
library;

import 'package:flutter/material.dart';

import '../models/enums.dart';

/// One illustrated destination on the adventure map.
class WorldDefinition {
  const WorldDefinition({
    required this.topic,
    required this.name,
    required this.subtitle,
    required this.color,
    required this.mark,
  });

  final DsaTopic topic;
  final String name;
  final String subtitle;
  final Color color;

  /// The printed world number on the map ("01" … "11").
  final String mark;
}

const List<WorldDefinition> worlds = [
  WorldDefinition(
    topic: DsaTopic.arrays,
    name: 'Array Orchard',
    subtitle: 'A little order. A lot to discover.',
    color: Color(0xFF386448),
    mark: '01',
  ),
  WorldDefinition(
    topic: DsaTopic.sorting,
    name: 'Sorting Workshop',
    subtitle: 'Make every piece fall into place.',
    color: Color(0xFF9B492C),
    mark: '02',
  ),
  WorldDefinition(
    topic: DsaTopic.stack,
    name: 'Stack Tower',
    subtitle: 'Build it up. Take it from the top.',
    color: Color(0xFF68518D),
    mark: '03',
  ),
  WorldDefinition(
    topic: DsaTopic.queue,
    name: 'Queue Station',
    subtitle: 'Everyone gets their turn.',
    color: Color(0xFF246B75),
    mark: '04',
  ),
  WorldDefinition(
    topic: DsaTopic.binarySearch,
    name: 'Search Observatory',
    subtitle: 'Narrow the sky. Find your star.',
    color: Color(0xFF425C96),
    mark: '05',
  ),
  WorldDefinition(
    topic: DsaTopic.linkedList,
    name: 'Linked-list Railway',
    subtitle: 'Follow the connections.',
    color: Color(0xFF8C4B65),
    mark: '06',
  ),
  WorldDefinition(
    topic: DsaTopic.hashTable,
    name: 'Hash Bazaar',
    subtitle: 'Count everything once.',
    color: Color(0xFF7A5C2E),
    mark: '07',
  ),
  WorldDefinition(
    topic: DsaTopic.strings,
    name: 'String Atelier',
    subtitle: 'Read from both ends.',
    color: Color(0xFF3F6B4F),
    mark: '08',
  ),
  WorldDefinition(
    topic: DsaTopic.trees,
    name: 'Tree Canopy',
    subtitle: 'Branch down, visit every node.',
    color: Color(0xFF2E5D50),
    mark: '09',
  ),
  WorldDefinition(
    topic: DsaTopic.heap,
    name: 'Heap Foundry',
    subtitle: 'Keep the k largest, drop the rest.',
    color: Color(0xFF6B3A4D),
    mark: '10',
  ),
  WorldDefinition(
    topic: DsaTopic.graphs,
    name: 'Graph Archipelago',
    subtitle: 'Islands, waves, and wandering words.',
    color: Color(0xFF2B5D7D),
    mark: '11',
  ),
];

/// The world for a catalogue topic id, falling back to the Orchard.
WorldDefinition worldForTopic(String? topicWire) {
  for (final world in worlds) {
    if (world.topic.wire == topicWire) return world;
  }
  return worlds.first;
}
