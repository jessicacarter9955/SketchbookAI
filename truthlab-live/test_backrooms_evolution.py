"""Backrooms genesis, motif emergence and editorial gating.
No genuine AI generation is faked; these tests exercise only the archival engine.
"""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

HERE=Path(__file__).parent
sys.path.insert(0,str(HERE))
import backrooms_evolution as evo
spec=importlib.util.spec_from_file_location("backrooms_test_app",HERE/"app.py")
app=importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class BackroomsEvolution(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        app.DB=str(Path(self.tmp.name)/"archive.sqlite")
        app.initialize()

    def tearDown(self):
        self.tmp.cleanup()

    def test_early_genesis_has_no_directed_cult_or_crypto(self):
        stage=app.evolution_snapshot()
        self.assertEqual(stage["phase"],"exploration")
        self.assertFalse(stage["motifs"])
        prompt=evo.prompt_for(stage,"Ari")
        self.assertIn("simulator@truthlab:~/$",prompt)
        self.assertIn("No preselected myth",prompt)
        self.assertNotIn("Goatse",prompt)
        self.assertNotIn("GOAT",prompt)
        self.assertNotIn("token launch",prompt)
        self.assertIn("without",prompt.lower())

    def test_recurring_motifs_from_both_voices_and_distinct_cycles(self):
        messages=[
            {"cycle":i,"speaker":sp,"mode":"live",
             "body":"The silver orchard returns through the archive of invented dreams."}
            for i in (1,2,3,4) for sp in ("Ari","Noor")]
        m=evo.discover(messages)
        self.assertIn("silver orchard",[v["motif"] for v in m])
        p=evo.phase_for(messages,[])
        self.assertEqual(p["phase"],"mythmaking")
        self.assertIn("silver orchard",evo.prompt_for(p,"Noor"))
        # Repetition solely inside one cycle isn't cultural development.
        all_same=[dict(x,cycle=1) for x in messages]
        self.assertEqual(evo.discover(all_same),[])

    def test_archive_persists_and_only_operator_curates(self):
        app.save_setting("workflow","backrooms")
        for i in (1,2,3,4):
            for sp in ("Ari","Noor"):
                app.publish(sp,"The silver orchard glows in a paradoxical library.","live",i)
            app.archive_backrooms(i)
        snap=app.evolution_snapshot()
        self.assertEqual(snap["phase"],"mythmaking")
        self.assertEqual(len(snap["artifacts"]),4)
        self.assertEqual(snap["curated_count"],0)
        self.assertTrue(all(x["status"]=="candidate" for x in snap["artifacts"]))
        a=snap["artifacts"][0]
        with app.connect() as db:
            updated=db.execute(
                "UPDATE evolution_artifacts SET status=? WHERE id=? AND workflow='backrooms'",
                ("curated",a["id"]))
            self.assertEqual(updated.rowcount,1)
        snap2=app.evolution_snapshot()
        self.assertEqual(snap2["phase"],"curation")
        self.assertEqual(snap2["curated_count"],1)
        # Independent workflow remains completely unchanged.
        app.save_setting("workflow","truthlab")
        self.assertEqual(app.get_state()["config"]["workflow"],"truthlab")
        self.assertEqual(app.get_state()["messages"],[])

    def test_candidates_reject_demo_and_operator_suggestions(self):
        msgs=[
            {"cycle":1,"speaker":"Operator","mode":"live","body":"silver orchard " * 5},
            {"cycle":2,"speaker":"Ari","mode":"demo","body":"silver orchard " * 5},
            {"cycle":3,"speaker":"Noor","mode":"live","body":"silver orchard " * 5},
        ]
        self.assertEqual(evo.discover(msgs),[])


if __name__=="__main__":
    unittest.main()
