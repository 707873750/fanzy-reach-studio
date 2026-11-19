import unittest
from gpu_stats import aggregate_engines, GpuSampler


class GpuTests(unittest.TestCase):
    def test_groups_same_engine_across_processes(self):
        name = 'luid_0x0_0x123_phys_0_eng_0_engtype_3D'
        result = aggregate_engines([('pid_1_'+name,20),('pid_2_'+name,30),('pid_1_luid_0x0_0x123_phys_0_eng_1_engtype_Copy',40)])
        self.assertEqual(result,{'gpuBusiestEnginePercent':50,'gpuEngineCount':2})

    def test_invalid_samples_are_not_zero_utilization(self):
        self.assertEqual(aggregate_engines([('invalid',0)]),{})
        self.assertEqual(aggregate_engines([('pid_1_luid_0x0_0x123_phys_0_eng_0_engtype_3D',float('nan'))]),{})

    def test_live_counter_and_close(self):
        gpu=GpuSampler()
        try:
            self.assertIn('gpuCounterStatus',gpu.sample())
        finally:
            gpu.close()
        self.assertNotEqual(gpu.sample()['gpuCounterStatus'],'ok')


if __name__ == '__main__':
    unittest.main()
