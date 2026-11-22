import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'companion'))
from configs import merge,turret_seats
class ConfigMergeTests(unittest.TestCase):
 def test_empty_turrets_replaces_parent_seats(self):
  self.assertEqual(merge({'turrets':{'mainturret':{'__inherit':'NewTurret'}}},{'turrets':{'__inherit':''}})['turrets'],{'__inherit':''})
 def test_extending_turrets_keeps_parent_and_applies_delete(self):
  parent={'turrets':{'mainturret':{'__inherit':'NewTurret'},'oldseat':{}}}
  patch={'turrets':{'__inherit':'Turrets','oldseat':{'__delete':True},'gunner':{'__inherit':'MainTurret'}}}
  result=merge(parent,patch)['turrets'];self.assertIn('mainturret',result);self.assertIn('gunner',result);self.assertNotIn('oldseat',result)
 def test_forward_declarations_do_not_add_seats(self):
  self.assertEqual(merge({}, {'seat':{'__external':True}}),{})
 def test_templates_are_not_seats_but_nested_and_ffv_seats_are(self):
  self.assertEqual(turret_seats({'mainturret':{'__inherit':'NewTurret'}}),0)
  self.assertEqual(turret_seats({'gunner':{'gunneraction':'gunner','turrets':{'commander':{'proxyindex':1}}},'ffv':{'proxyindex':8,'ispersonturret':1},'disabled':{'proxyindex':2,'hasgunner':0}}),3)
if __name__=='__main__':unittest.main()
