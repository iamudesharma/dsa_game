"""Regression checks for budget selection; no Docker or network required."""
import importlib.util
import pathlib
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'benchmark', pathlib.Path(__file__).with_name('rust-container-benchmark.py'))
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


class BudgetTests(unittest.TestCase):
    def report(self, **changes):
        report = dict(accepted=False, oomKilled=False, errors=[],
                      measuredElapsedSeconds=3601, peakBytes=231 * 2**20,
                      steadyGrowthBytes=0, peakLimitMiB=230)
        report.update(changes)
        return report

    def test_peak_and_growth_rejection_allow_fallback(self):
        self.assertTrue(benchmark.memory_rejected(self.report()))
        self.assertTrue(benchmark.memory_rejected(
            self.report(peakBytes=100 * 2**20, steadyGrowthBytes=6 * 2**20)))

    def test_oom_allows_fallback_even_when_connections_fail_early(self):
        self.assertTrue(benchmark.memory_rejected(
            self.report(oomKilled=True, errors=['connection closed'], measuredElapsedSeconds=60)))

    def test_behavior_errors_and_incomplete_measurements_do_not_allow_fallback(self):
        self.assertFalse(benchmark.memory_rejected(self.report(errors=['wrong state'])))
        self.assertFalse(benchmark.memory_rejected(self.report(measuredElapsedSeconds=60)))
        self.assertFalse(benchmark.memory_rejected(self.report(peakBytes=None, steadyGrowthBytes=None)))
        self.assertFalse(benchmark.memory_rejected(self.report(accepted=True)))

    def test_larger_budget_is_recorded_and_used_for_both_backends(self):
        args = types.SimpleNamespace(node_image='node-image', rust_image='rust-image', seconds=3600, backend='both', profile='soak')
        report = self.report(accepted=True, peakLimitMiB=460, peakBytes=300 * 2**20)
        with tempfile.TemporaryDirectory() as directory, patch.object(
                benchmark, 'run', return_value=report) as run:
            output = pathlib.Path(directory) / 'fallback-512'
            self.assertEqual(benchmark.benchmark_pair(args, output, [], 512), report)
            self.assertEqual([call.args[-2] for call in run.call_args_list], [512, 512])
            saved = benchmark.json.loads((output / 'comparison.json').read_text())
            self.assertEqual(saved['memoryLimitMiB'], 512)
            self.assertEqual(saved['peakLimitMiB'], 460)
            self.assertTrue(saved['rustAccepted'])

    def test_quick_profile_runs_only_rust_and_spreads_problem_types(self):
        args = types.SimpleNamespace(node_image='node', rust_image='rust',
                                     seconds=300, backend='rust', profile='quick')
        fixtures = [{'id': 'a', 'seed': 0}, {'id': 'a', 'seed': 1}, {'id': 'b', 'seed': 0}]
        report = self.report(accepted=True, requiredDurationSeconds=300)
        with tempfile.TemporaryDirectory() as directory, patch.object(
                benchmark, 'run', return_value=report) as run:
            benchmark.benchmark_pair(args, pathlib.Path(directory), fixtures, 256)
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[4], [fixtures[0], fixtures[2]])
            self.assertEqual(run.call_args.args[-1], 'quick')

    def test_quick_memory_failure_uses_its_own_duration(self):
        self.assertTrue(benchmark.memory_rejected(
            self.report(requiredDurationSeconds=300, measuredElapsedSeconds=301)))
        self.assertFalse(benchmark.memory_rejected(
            self.report(requiredDurationSeconds=300, measuredElapsedSeconds=299)))


if __name__ == '__main__':
    unittest.main()
