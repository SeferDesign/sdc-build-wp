use std::collections::BTreeMap;
use std::rc::Rc;

use mago_codex::ttype::union::TUnion;

#[derive(Clone, Debug)]
pub struct FinallyScope {
    pub locals: BTreeMap<String, Rc<TUnion>>,
}

impl FinallyScope {
    pub fn new() -> Self {
        Self { locals: BTreeMap::new() }
    }
}

impl Default for FinallyScope {
    fn default() -> Self {
        Self::new()
    }
}
