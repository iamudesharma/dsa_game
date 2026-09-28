/// Catalogue loading: `GET /api/catalogue` plus the optional health probe used
/// to explain *why* generation would be slow or unavailable.
///
/// Pull-to-refresh is deliberately not wired up. The catalogue is small and
/// static for a demo server, so the screens show explicit "Reload" affordances
/// and real error states instead of an ambiguous gesture.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/api.dart';
import '../models/problem.dart';
import '../services/api_client.dart';
import '../services/api_exception.dart';

class CatalogueController extends ChangeNotifier {
  CatalogueController(this._api);

  final ApiClient _api;

  CatalogueResponse? _catalogue;
  ApiException? _error;
  bool _loading = false;
  HealthResponse? _health;

  /// Health is a soft signal — a failure here must not hide the catalogue.
  HealthResponse? get health => _health;

  CatalogueResponse? get catalogue => _catalogue;

  ApiException? get error => _error;

  bool get isLoading => _loading;

  bool get hasData => _catalogue != null && !_catalogue!.isEmpty;

  String get baseUrl => _api.config.baseUrl;

  Future<void> load({bool silent = false}) async {
    if (_loading) return;
    _loading = true;
    if (!silent) _error = null;
    notifyListeners();
    try {
      _catalogue = await _api.fetchCatalogue();
      _error = null;
    } on ApiException catch (e) {
      _error = e;
    } finally {
      _loading = false;
      notifyListeners();
    }
    if (_catalogue != null) unawaited(_probeHealth());
  }

  /// Best-effort: shows the live tier / Laya status in the topic screen footer.
  Future<void> _probeHealth() async {
    try {
      _health = await _api.fetchHealth();
    } on ApiException {
      _health = null;
    }
    notifyListeners();
  }
}
