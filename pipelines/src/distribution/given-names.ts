/**
 * Common given names (US-weighted, with frequent European, Latin American and
 * transliterated Asian names). A capitalised pair beside a job title is only
 * read as a person when its first word is here: "Macro Trends, CEO" and
 * "Houston Construction Director" are headings, not people.
 */
export const GIVEN_NAMES: ReadonlySet<string> = new Set(
    `aaron abby abigail adam adrian adriana aidan aiden aisha alan albert alberto alec alejandra
alejandro alex alexa alexander alexandra alexis alfred ali alice alicia alison allison alma
amanda amber amelia amir amy ana andre andrea andres andrew andy angel angela angelica angie
anita ann anna anne annie anthony antonio april ariana ariel arthur ashley audrey austin ava
barbara barry beatriz becky ben benjamin benoit bernard beth betty beverly bill billy blake
bob bobby bonnie brad bradley brandon brenda brendan brett brian briana bridget brittany brooke
bruce bruno bryan caitlin caleb cameron camila carl carla carlos carmen carol caroline carolyn
carrie casey cassandra catherine cathy cecilia chad charles charlie charlotte chase chelsea
cheryl chloe chris christian christina christine christopher cindy claire clara claudia clayton
cody colin connor courtney craig cristina crystal curtis cynthia daisy dale dan dana daniel
daniela danielle danny darius darren dave david dawn dean debbie deborah debra denise dennis
derek diana diane diego dominic don donald donna doris dorothy doug douglas drew dustin dylan
ed eddie edgar eduardo edward eileen elaine elena eli elijah elizabeth ella ellen elliot emily
emma eric erica erik erin ernesto esther ethan eugene eva evan evelyn faith fatima felix
fernando fiona frances francesca francis francisco frank fred gabriel gabriela gabrielle gail
gary gavin george georgia gerald gina giovanni giulia glen glenn gloria grace graham grant greg
gregory hailey hannah harold harry hassan hayden heather hector heidi helen henry holly hope
howard hugo ian irene isaac isabel isabella ivan jack jackie jackson jacob jacqueline jade
jaime jake james jamie jan jane janet janice jared jasmine jason javier jay jean jeff jeffrey
jenna jennifer jenny jeremy jerry jesse jessica jesus jill jim jimmy jo joan joanna joanne joe
joel john johnny jon jonathan jordan jorge jose joseph josephine josh joshua joy juan judith
judy julia julian julie justin karen karl kate katherine kathleen kathryn kathy katie kayla
keith kelly ken kendra kenneth kevin kim kimberly kirk kristen kristin kyle lance lara larry
laura lauren laurie leah lee leo leon leslie liam lily linda lindsay lindsey lisa logan lori
louis louise lucas lucia lucy luis luke lydia lynn madeline madison maggie manuel marc marcus
margaret maria mariana marie marilyn mario marisa mark marta martha martin marvin mary mason
matt matthew maureen max maya megan melanie melissa meredith mia michael michelle miguel mike
miles miranda missy mitchell mohamed mohammed molly monica morgan nancy naomi natalie nathan
neil nicholas nick nicole nina noah noel nora olga olivia omar oscar owen pablo paige pamela
patricia patrick paul paula pedro peggy penny peter philip phillip pierre priya rachel rafael
ralph ramon randy raquel ray raymond rebecca regina renee ricardo richard rick ricky riley rita
rob robert roberta roberto robin rodney roger ron ronald rosa rose ross roy ruby russell ruth
ryan sabrina sally sam samantha samuel sandra sara sarah scott sean sebastian sergio seth
shannon sharon shawn sheila shelby shirley sierra simon sofia sonia sophia sophie stacy
stanley stephanie stephen steve steven sue susan suzanne sydney tamara tammy tanya tara taylor
ted teresa terry theresa thomas tiffany tim timothy tina todd tom tommy tony tracy travis trevor
tyler valerie vanessa victor victoria vincent virginia wade walter wanda wayne wei wendy
william willie xavier yolanda yvonne zach zachary zoe
akira anil arjun deepak hiro hiroshi jin jun kenji li ling mei ming raj rahul ravi sanjay
sunil wang yuki yusuf
anke annelies bram daan dirk floor freek henk jan joost kees lars lotte maarten pieter ruud
sanne sven thijs wim
andreas florian heinz jens jurgen katrin klaus matthias stefan uwe wolfgang
`
        .split(/\s+/)
        .filter(Boolean)
);
